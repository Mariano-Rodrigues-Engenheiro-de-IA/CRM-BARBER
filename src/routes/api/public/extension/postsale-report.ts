// GET /api/public/extension/postsale-report?funnel_id=X&period=day|week|month
//
// Conta: atendimentos marcados (entradas na etapa "Pós-venda" no
// histórico), pós-vendas enviados e retornos enviados (via
// funnel_followup_sent_log, distinguindo os 2 passos pelo sort_order:
// 0 = pós-venda, 1 = retorno) — tudo filtrado pelo período escolhido.

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

function periodStart(period: string): Date {
  const now = new Date();
  if (period === "day") {
    now.setHours(0, 0, 0, 0);
    return now;
  }
  if (period === "month") {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  // week: últimos 7 dias corridos (mais simples e previsível que "semana
  // do calendário", que varia conforme o dia em que se consulta)
  return new Date(now.getTime() - 7 * 24 * 3600_000);
}

export const Route = createFileRoute("/api/public/extension/postsale-report")({
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
        const period = url.searchParams.get("period") || "week";
        if (!funnelId) {
          return jsonResponse(
            request,
            { ok: false, error: "funnel_id obrigatório" },
            { status: 400 },
          );
        }
        const since = periodStart(period).toISOString();

        const { data: stage } = await supabaseAdmin
          .from("funnel_stages")
          .select("id")
          .eq("funnel_id", funnelId)
          .eq("barbershop_id", auth.token.barbershop_id)
          .maybeSingle();
        if (!stage) {
          return jsonResponse(request, {
            ok: true,
            report: { attendances: 0, postsale_sent: 0, return_sent: 0 },
          });
        }

        const { data: rule } = await supabaseAdmin
          .from("funnel_followup_rules")
          .select("id, funnel_followup_steps (id, sort_order)")
          .eq("funnel_id", funnelId)
          .eq("stage_id", stage.id)
          .eq("barbershop_id", auth.token.barbershop_id)
          .maybeSingle();

        const steps = (
          (rule?.funnel_followup_steps as Array<{ id: string; sort_order: number }>) || []
        )
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order);
        const postSaleStepId = steps[0]?.id;
        const returnStepId = steps[1]?.id;

        const { count: attendances } = await supabaseAdmin
          .from("funnel_card_stage_history")
          .select("id", { count: "exact", head: true })
          .eq("stage_id", stage.id)
          .gte("entered_at", since);

        let postsaleSent = 0;
        let returnSent = 0;
        if (postSaleStepId) {
          const { count } = await supabaseAdmin
            .from("funnel_followup_sent_log")
            .select("id", { count: "exact", head: true })
            .eq("step_id", postSaleStepId)
            .gte("sent_at", since);
          postsaleSent = count ?? 0;
        }
        if (returnStepId) {
          const { count } = await supabaseAdmin
            .from("funnel_followup_sent_log")
            .select("id", { count: "exact", head: true })
            .eq("step_id", returnStepId)
            .gte("sent_at", since);
          returnSent = count ?? 0;
        }

        return jsonResponse(request, {
          ok: true,
          report: {
            attendances: attendances ?? 0,
            postsale_sent: postsaleSent,
            return_sent: returnSent,
          },
        });
      },
    },
  },
});
