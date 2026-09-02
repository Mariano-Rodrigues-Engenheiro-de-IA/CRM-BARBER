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

const STEP_COLS = "id, delay_minutes, actions, template_name, template_language, template_header_media_path, skip_if_replied, sort_order";

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
          .select(`id, funnel_id, stage_id, active, funnel_followup_steps (${STEP_COLS})`)
          .eq("barbershop_id", auth.token.barbershop_id);
        if (funnelId) query = query.eq("funnel_id", funnelId);
        const { data, error } = await query;
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        const rules = (data ?? []).map((r) => ({
          ...r,
          steps: (r.funnel_followup_steps as unknown[] || [])
            .slice()
            .sort((a, b) => (a as { sort_order: number }).sort_order - (b as { sort_order: number }).sort_order),
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

        const { getBillingStatus } = await import("@/lib/billing.server");
        const billing = await getBillingStatus(supabaseAdmin, shop);
        if (!billing.premium) {
          return jsonResponse(request, { ok: false, error: "Follow-up faz parte do plano Premium." }, { status: 402 });
        }

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
        if (ruleId) {
          const { error: updErr } = await supabaseAdmin
            .from("funnel_followup_rules")
            .update({ active: parsed.data.active ?? true })
            .eq("id", ruleId);
          if (updErr) return jsonResponse(request, { ok: false, error: updErr.message }, { status: 500 });
          // Recomeça os passos do zero — mais simples e previsível que
          // tentar casar/atualizar item a item.
          await supabaseAdmin.from("funnel_followup_steps").delete().eq("rule_id", ruleId);
        } else {
          const { data: created, error: insErr } = await supabaseAdmin
            .from("funnel_followup_rules")
            .insert({
              barbershop_id: shop,
              funnel_id: parsed.data.funnel_id,
              stage_id: parsed.data.stage_id,
              active: parsed.data.active ?? true,
            })
            .select("id")
            .single();
          if (insErr || !created) {
            return jsonResponse(request, { ok: false, error: insErr?.message ?? "Falha ao criar regra" }, { status: 500 });
          }
          ruleId = created.id;
        }

        const { error: stepsErr } = await supabaseAdmin.from("funnel_followup_steps").insert(
          parsed.data.steps.map((s, i) => ({
            rule_id: ruleId,
            sort_order: i,
            delay_minutes: s.delay_minutes,
            actions: s.actions ?? [],
            template_name: s.template_name ?? null,
            template_language: s.template_language ?? null,
            template_header_media_path: s.template_header_media_path ?? null,
            skip_if_replied: s.skip_if_replied ?? false,
          })),
        );
        if (stepsErr) {
          return jsonResponse(request, { ok: false, error: stepsErr.message }, { status: 500 });
        }

        const { data: full } = await supabaseAdmin
          .from("funnel_followup_rules")
          .select(`id, funnel_id, stage_id, active, funnel_followup_steps (${STEP_COLS})`)
          .eq("id", ruleId)
          .single();
        return jsonResponse(request, { ok: true, rule: full });
      },
    },
  },
});
