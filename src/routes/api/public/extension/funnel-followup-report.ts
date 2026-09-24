// GET /api/public/extension/funnel-followup-report -> lista TODOS os
// envios de follow-up já feitos (não só de um lead) — quem recebeu o quê,
// quando, em qual funil/etapa. Opcionalmente filtra por funil.
//
// Reescrito sem usar a sintaxe de relacionamento embutido do Supabase
// (ex: "funnels(name)") - achado real: essa sintaxe depende de o
// PostgREST conseguir resolver a relação sozinho, e se isso falhar (FK
// ambígua, schema cache desatualizado, etc.) a query inteira retorna
// erro, sem aviso nenhum pro usuário - o frontend tratava esse erro
// exatamente igual a "nenhuma mensagem enviada", escondendo o problema
// de verdade. Agora busca cada tabela separada e junta na mão, sem
// depender desse recurso.

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const LIMIT = 200;

export const Route = createFileRoute("/api/public/extension/funnel-followup-report")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const shop = auth.token.barbershop_id;
        const url = new URL(request.url);
        const funnelId = url.searchParams.get("funnel_id");

        // Todas as regras dessa barbearia (pra filtrar o log, que não tem
        // barbershop_id direto — passa pelo card).
        let rulesQuery = supabaseAdmin
          .from("funnel_followup_rules")
          .select("id, funnel_id, stage_id")
          .eq("barbershop_id", shop);
        if (funnelId) rulesQuery = rulesQuery.eq("funnel_id", funnelId);
        const { data: rules, error: rulesErr } = await rulesQuery;
        if (rulesErr) return jsonResponse(request, { ok: false, error: rulesErr.message }, { status: 500 });
        if (!rules?.length) return jsonResponse(request, { ok: true, entries: [] });

        // Busca nomes de funis e etapas separado, sem relacionamento
        // embutido - um select simples por tabela, com os IDs coletados
        // das regras.
        const funnelIds = [...new Set(rules.map((r) => r.funnel_id))];
        const stageIds = [...new Set(rules.map((r) => r.stage_id))];
        const [funnelsRes, stagesRes] = await Promise.all([
          supabaseAdmin.from("funnels").select("id, name").in("id", funnelIds),
          supabaseAdmin.from("funnel_stages").select("id, name").in("id", stageIds),
        ]);
        const funnelNameById = new Map((funnelsRes.data ?? []).map((f) => [f.id, f.name]));
        const stageNameById = new Map((stagesRes.data ?? []).map((s) => [s.id, s.name]));

        const ruleIds = rules.map((r) => r.id);
        const { data: steps, error: stepsErr } = await supabaseAdmin
          .from("funnel_followup_steps")
          .select("id, rule_id")
          .in("rule_id", ruleIds);
        if (stepsErr) return jsonResponse(request, { ok: false, error: stepsErr.message }, { status: 500 });

        const ruleById = new Map(rules.map((r) => [r.id, r]));
        const stepToRule = new Map<string, { funnelName: string; stageName: string }>();
        for (const s of steps ?? []) {
          const rule = ruleById.get(s.rule_id);
          if (!rule) continue;
          stepToRule.set(s.id, {
            funnelName: funnelNameById.get(rule.funnel_id) ?? "",
            stageName: stageNameById.get(rule.stage_id) ?? "",
          });
        }
        const stepIds = [...stepToRule.keys()];
        if (!stepIds.length) return jsonResponse(request, { ok: true, entries: [] });

        const { data: logs, error: logsErr } = await supabaseAdmin
          .from("funnel_followup_sent_log")
          .select("id, card_id, step_id, sent_at")
          .in("step_id", stepIds)
          .order("sent_at", { ascending: false })
          .limit(LIMIT);
        if (logsErr) return jsonResponse(request, { ok: false, error: logsErr.message }, { status: 500 });

        const cardIds = [...new Set((logs ?? []).map((l) => l.card_id).filter(Boolean))];
        const { data: cards } = cardIds.length
          ? await supabaseAdmin.from("funnel_cards").select("id, title, phone").in("id", cardIds)
          : { data: [] as Array<{ id: string; title: string; phone: string }> };
        const cardById = new Map((cards ?? []).map((c) => [c.id, c]));

        const entries = (logs ?? []).map((l) => {
          const card = cardById.get(l.card_id as string);
          const ruleInfo = stepToRule.get(l.step_id as string);
          return {
            id: l.id,
            card_title: card?.title ?? "",
            phone: card?.phone ?? "",
            funnel_name: ruleInfo?.funnelName ?? "",
            stage_name: ruleInfo?.stageName ?? "",
            sent_at: l.sent_at,
          };
        });

        return jsonResponse(request, { ok: true, entries });
      },
    },
  },
});
