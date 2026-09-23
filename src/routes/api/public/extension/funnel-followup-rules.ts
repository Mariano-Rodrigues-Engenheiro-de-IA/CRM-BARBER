// GET  /api/public/extension/funnel-followup-rules?funnel_id=X -> lista as regras (com os passos)
// POST /api/public/extension/funnel-followup-rules -> cria uma regra + seus passos
//
// Uma regra = um funil + uma etapa (stage_id) + uma sequência de passos.
// Só pode ter UMA regra por (funnel_id, stage_id) — criar de novo pra uma
// combinação já existente edita a mesma (ver upsert abaixo).

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { funnelFollowupRuleSchema } from "@/lib/funnel-followups";

const STEP_COLS =
  "id, delay_minutes, actions, template_name, template_language, template_header_media_path, sort_order";
const RULE_COLS =
  "id, name, funnel_id, stage_id, active, trigger_type, moment, skip_if_replied, badge_period_days";

export const Route = createFileRoute("/api/public/extension/funnel-followup-rules")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const url = new URL(request.url);
        const funnelId = url.searchParams.get("funnel_id");
        let query = supabaseAdmin
          .from("funnel_followup_rules")
          .select(`${RULE_COLS}, funnel_followup_steps (${STEP_COLS})`)
          .eq("barbershop_id", auth.token.barbershop_id);
        if (funnelId) query = query.eq("funnel_id", funnelId);
        const { data, error } = await query;
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        const rules = (data ?? []).map((r) => ({
          ...r,
          steps: ((r.funnel_followup_steps as unknown[]) || [])
            .slice()
            .sort(
              (a, b) =>
                (a as { sort_order: number }).sort_order - (b as { sort_order: number }).sort_order,
            ),
          funnel_followup_steps: undefined,
        }));
        return jsonResponse(request, { ok: true, rules });
      },

      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return jsonResponse(request, { ok: false, error: "Invalid JSON" }, { status: 400 });
        }
        const parsed = funnelFollowupRuleSchema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(
            request,
            { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
            { status: 400 },
          );
        }
        const shop = auth.token.barbershop_id;

        const { getBillingStatus, followUpActiveBlock } = await import("@/lib/billing.server");
        const billing = await getBillingStatus(supabaseAdmin, shop);
        // Pós-venda não entra nessa trava - ele é limitado por volume de
        // mensagem enviada por dia (postSaleDailyBlock), não por poder
        // configurar a regra. Só follow-up normal (funil que não é o de
        // pós-venda) trava em 1 sequência ativa no grátis.
        const { data: targetFunnel } = await supabaseAdmin
          .from("funnels")
          .select("mode")
          .eq("id", parsed.data.funnel_id)
          .eq("barbershop_id", shop)
          .maybeSingle();
        const isPostSaleFunnel = targetFunnel?.mode === "postsale";
        if (!isPostSaleFunnel && (parsed.data.active ?? true)) {
          const blocked = followUpActiveBlock(billing);
          if (blocked) {
            return jsonResponse(request, { ok: false, error: blocked }, { status: 402 });
          }
        }

        const moment = parsed.data.moment ?? "time_in_stage";
        // "entered" e "time_in_stage" usam o mesmo trigger_type
        // internamente (ambos contam a partir da entrada na etapa) —
        // só "left_stage" muda a lógica de avaliação de verdade.
        const triggerType = moment === "left_stage" ? "left_stage" : "time_in_stage";

        // Upsert manual por (funnel_id, stage_id) — se já existe uma regra
        // pra essa etapa, edita ela (substitui os passos) em vez de criar
        // duplicada (o índice único no banco pegaria isso, mas fazer a
        // checagem aqui devolve uma mensagem melhor e evita erro 500).
        const { data: existing } = await supabaseAdmin
          .from("funnel_followup_rules")
          .select("id")
          .eq("barbershop_id", shop)
          .eq("funnel_id", parsed.data.funnel_id)
          .eq("stage_id", parsed.data.stage_id)
          .maybeSingle();

        let ruleId = existing?.id as string | undefined;
        // Passos já existentes dessa regra (se houver) — usados pra
        // decidir quem atualiza (preserva histórico), quem é novo
        // (insere) e quem sumiu (remove só esse).
        let existingStepIds: string[] = [];
        if (ruleId) {
          const { data: existingSteps } = await supabaseAdmin
            .from("funnel_followup_steps")
            .select("id")
            .eq("rule_id", ruleId);
          existingStepIds = (existingSteps ?? []).map((s) => s.id as string);

          const { error: updErr } = await supabaseAdmin
            .from("funnel_followup_rules")
            .update({
              name: parsed.data.name ?? null,
              active: parsed.data.active ?? true,
              trigger_type: triggerType,
              moment,
              skip_if_replied: parsed.data.skip_if_replied ?? true,
              badge_period_days: parsed.data.badge_period_days ?? 30,
            })
            .eq("id", ruleId);
          if (updErr)
            return jsonResponse(request, { ok: false, error: updErr.message }, { status: 500 });
        } else {
          const { data: created, error: insErr } = await supabaseAdmin
            .from("funnel_followup_rules")
            .insert({
              barbershop_id: shop,
              name: parsed.data.name ?? null,
              funnel_id: parsed.data.funnel_id,
              stage_id: parsed.data.stage_id,
              active: parsed.data.active ?? true,
              trigger_type: triggerType,
              moment,
              skip_if_replied: parsed.data.skip_if_replied ?? true,
              badge_period_days: parsed.data.badge_period_days ?? 30,
            })
            .select("id")
            .single();
          if (insErr || !created) {
            return jsonResponse(
              request,
              { ok: false, error: insErr?.message ?? "Falha ao criar regra" },
              { status: 500 },
            );
          }
          ruleId = created.id;
        }

        // Upsert de verdade nos passos — CRÍTICO: nunca apagar e
        // recriar um passo que continua existindo. O histórico de "já
        // enviado" (funnel_followup_sent_log / *_left_stage_sent)
        // referencia o ID do passo com ON DELETE CASCADE — apagar o
        // passo apaga junto todo o histórico de quem já recebeu, e a
        // próxima rodada do cron manda tudo de novo pra quem já tinha
        // recebido (bug real reportado 22/09: reativar/salvar a regra
        // de Pós-venda mandou mensagem de novo pra quem já tinha
        // recebido). Passos com "id" no payload que batem com um
        // existente são ATUALIZADOS (preserva o ID); os outros são
        // criados; os que existiam mas sumiram do payload são
        // removidos (só esses, não todos).
        const payloadStepIds = new Set(
          parsed.data.steps.map((s) => s.id).filter((id): id is string => !!id),
        );
        const toRemove = existingStepIds.filter((id) => !payloadStepIds.has(id));
        if (toRemove.length) {
          await supabaseAdmin.from("funnel_followup_steps").delete().in("id", toRemove);
        }

        for (let i = 0; i < parsed.data.steps.length; i++) {
          const s = parsed.data.steps[i];
          const stepData = {
            rule_id: ruleId,
            sort_order: i,
            delay_minutes: s.delay_minutes,
            actions: s.actions ?? [],
            template_name: s.template_name ?? null,
            template_language: s.template_language ?? null,
            template_header_media_path: s.template_header_media_path ?? null,
          };
          if (s.id && existingStepIds.includes(s.id)) {
            const { error: stepUpdErr } = await supabaseAdmin
              .from("funnel_followup_steps")
              .update(stepData)
              .eq("id", s.id);
            if (stepUpdErr) {
              return jsonResponse(
                request,
                { ok: false, error: stepUpdErr.message },
                { status: 500 },
              );
            }
          } else {
            const { error: stepInsErr } = await supabaseAdmin
              .from("funnel_followup_steps")
              .insert(stepData);
            if (stepInsErr) {
              return jsonResponse(
                request,
                { ok: false, error: stepInsErr.message },
                { status: 500 },
              );
            }
          }
        }

        const { data: full } = await supabaseAdmin
          .from("funnel_followup_rules")
          .select(`${RULE_COLS}, funnel_followup_steps (${STEP_COLS})`)
          .eq("id", ruleId)
          .single();
        return jsonResponse(request, { ok: true, rule: full });
      },
    },
  },
});
