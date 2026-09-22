// GET /api/public/extension/postsale-attendances?funnel_id=X&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Lista cada atendimento marcado individualmente (não só a contagem) —
// nome do cliente, telefone, data/hora — pra quem quer ver QUEM foi
// atendido, não só quantos. Filtro opcional por intervalo de data.

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

export const Route = createFileRoute("/api/public/extension/postsale-attendances")({
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
        const from = url.searchParams.get("from"); // YYYY-MM-DD
        const to = url.searchParams.get("to"); // YYYY-MM-DD
        if (!funnelId) {
          return jsonResponse(
            request,
            { ok: false, error: "funnel_id obrigatório" },
            { status: 400 },
          );
        }

        const { data: stage } = await supabaseAdmin
          .from("funnel_stages")
          .select("id")
          .eq("funnel_id", funnelId)
          .eq("barbershop_id", auth.token.barbershop_id)
          .maybeSingle();
        if (!stage) {
          return jsonResponse(request, { ok: true, attendances: [] });
        }

        let query = supabaseAdmin
          .from("funnel_card_stage_history")
          .select("id, entered_at, funnel_cards(title, phone)")
          .eq("stage_id", stage.id)
          .order("entered_at", { ascending: false })
          .limit(500);
        if (from) query = query.gte("entered_at", `${from}T00:00:00`);
        if (to) query = query.lte("entered_at", `${to}T23:59:59`);

        const { data, error } = await query;
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }

        const attendances = (data ?? []).map((row) => {
          const card = row.funnel_cards as unknown as {
            title: string | null;
            phone: string | null;
          };
          return {
            id: row.id,
            entered_at: row.entered_at,
            name: card?.title || card?.phone || "Sem nome",
            phone: card?.phone || null,
          };
        });

        return jsonResponse(request, { ok: true, attendances });
      },
    },
  },
});
