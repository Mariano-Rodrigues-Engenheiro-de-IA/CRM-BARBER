// GET /api/public/extension/postsale-attendance-count?phone=X (ou wa_contact_id=X)
//
// Quantas vezes esse cliente foi marcado como atendido dentro do
// período configurado na regra de Pós-venda (badge_period_days,
// padrão 30 dias) — usado pro selinho numérico na tesourinha, tanto
// no CRM (kanban) quanto na extensão (dentro da conversa).

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

export const Route = createFileRoute("/api/public/extension/postsale-attendance-count")({
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
        const phone = url.searchParams.get("phone");
        const waContactId = url.searchParams.get("wa_contact_id");
        if (!phone && !waContactId) {
          return jsonResponse(request, { ok: true, count: 0 });
        }
        const shop = auth.token.barbershop_id;

        const { data: funnel } = await supabaseAdmin
          .from("funnels")
          .select("id")
          .eq("barbershop_id", shop)
          .eq("mode", "postsale")
          .maybeSingle();
        if (!funnel) {
          return jsonResponse(request, { ok: true, count: 0 });
        }

        const { data: stage } = await supabaseAdmin
          .from("funnel_stages")
          .select("id")
          .eq("funnel_id", funnel.id)
          .eq("barbershop_id", shop)
          .maybeSingle();
        if (!stage) {
          return jsonResponse(request, { ok: true, count: 0 });
        }

        const { data: rule } = await supabaseAdmin
          .from("funnel_followup_rules")
          .select("badge_period_days")
          .eq("funnel_id", funnel.id)
          .eq("stage_id", stage.id)
          .maybeSingle();
        const periodDays = rule?.badge_period_days ?? 30;
        const since = new Date(Date.now() - periodDays * 24 * 3600_000).toISOString();

        let cardQuery = supabaseAdmin
          .from("funnel_cards")
          .select("id")
          .eq("barbershop_id", shop)
          .eq("funnel_id", funnel.id);
        cardQuery = waContactId
          ? cardQuery.eq("wa_contact_id", waContactId)
          : cardQuery.eq("phone", phone as string);
        const { data: card } = await cardQuery.maybeSingle();
        if (!card) {
          return jsonResponse(request, { ok: true, count: 0 });
        }

        const { count } = await supabaseAdmin
          .from("funnel_card_stage_history")
          .select("id", { count: "exact", head: true })
          .eq("card_id", card.id)
          .eq("stage_id", stage.id)
          .gte("entered_at", since);

        return jsonResponse(request, { ok: true, count: count ?? 0 });
      },
    },
  },
});
