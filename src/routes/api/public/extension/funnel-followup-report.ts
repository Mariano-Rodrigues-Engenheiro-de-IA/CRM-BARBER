// GET /api/public/extension/funnel-followup-report -> lista TODOS os
// envios de follow-up já feitos (não só de um lead) — quem recebeu o quê,
// quando, em qual funil/etapa. Opcionalmente filtra por funil.

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
          .select("id, funnel_id, stage_id, funnels(name), funnel_stages(name)")
          .eq("barbershop_id", shop);
        if (funnelId) rulesQuery = rulesQuery.eq("funnel_id", funnelId);
        const { data: rules, error: rulesErr } = await rulesQuery;
        if (rulesErr) return jsonResponse(request, { ok: false, error: rulesErr.message }, { status: 500 });
        if (!rules?.length) return jsonResponse(request, { ok: true, entries: [] });

        const stepToRule = new Map<string, { funnelName: string; stageName: string }>();
        for (const r of rules) {
          const { data: steps } = await supabaseAdmin
            .from("funnel_followup_steps")
            .select("id, delay_minutes")
            .eq("rule_id", r.id);
          for (const s of steps ?? []) {
            stepToRule.set(s.id, {
              funnelName: (r.funnels as unknown as { name: string } | null)?.name ?? "",
              stageName: (r.funnel_stages as unknown as { name: string } | null)?.name ?? "",
            });
          }
        }
        const stepIds = [...stepToRule.keys()];
        if (!stepIds.length) return jsonResponse(request, { ok: true, entries: [] });

        const { data: logs, error: logsErr } = await supabaseAdmin
          .from("funnel_followup_sent_log")
          .select("id, card_id, step_id, sent_at, funnel_cards(title, phone)")
          .in("step_id", stepIds)
          .order("sent_at", { ascending: false })
          .limit(LIMIT);
        if (logsErr) return jsonResponse(request, { ok: false, error: logsErr.message }, { status: 500 });

        const entries = (logs ?? []).map((l) => {
          const card = l.funnel_cards as unknown as { title: string; phone: string } | null;
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
