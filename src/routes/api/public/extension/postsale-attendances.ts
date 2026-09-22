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
          .select("id, entered_at, funnel_cards(phone, title, customer_id, wa_contact_id)")
          .eq("stage_id", stage.id)
          .order("entered_at", { ascending: false })
          .limit(500);
        if (from) query = query.gte("entered_at", `${from}T00:00:00`);
        if (to) query = query.lte("entered_at", `${to}T23:59:59`);

        const { data, error } = await query;
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }

        type CardRow = {
          phone: string | null;
          title: string | null;
          customer_id: string | null;
          wa_contact_id: string | null;
        };
        const rows = (data ?? []).map((row) => ({
          id: row.id,
          entered_at: row.entered_at,
          card: row.funnel_cards as unknown as CardRow | null,
        }));

        // O card às vezes só tem o telefone salvo como "nome" (quando o
        // WhatsApp ainda não tinha o nome do contato disponível no
        // momento de marcar) — busca um nome melhor em duas fontes que
        // costumam já ter isso: o cadastro de cliente (customers) e o
        // contato sincronizado do WhatsApp (wa_contacts).
        const customerIds = [
          ...new Set(rows.map((r) => r.card?.customer_id).filter(Boolean)),
        ] as string[];
        const waContactIds = [
          ...new Set(rows.map((r) => r.card?.wa_contact_id).filter(Boolean)),
        ] as string[];
        const [{ data: customers }, { data: waContacts }] = await Promise.all([
          customerIds.length
            ? supabaseAdmin.from("customers").select("id, name").in("id", customerIds)
            : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
          waContactIds.length
            ? supabaseAdmin.from("wa_contacts").select("id, name").in("id", waContactIds)
            : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
        ]);
        const customerNameById = new Map((customers ?? []).map((c) => [c.id, c.name]));
        const waContactNameById = new Map((waContacts ?? []).map((c) => [c.id, c.name]));

        const attendances = rows.map((r) => {
          const card = r.card;
          const looksLikePhone = card?.title && card.title.replace(/\D/g, "") === card.title;
          const bestName =
            (card?.title && !looksLikePhone && card.title) ||
            (card?.customer_id && customerNameById.get(card.customer_id)) ||
            (card?.wa_contact_id && waContactNameById.get(card.wa_contact_id)) ||
            card?.title ||
            card?.phone ||
            "Sem nome";
          return {
            id: r.id,
            entered_at: r.entered_at,
            name: bestName,
            phone: card?.phone || null,
          };
        });

        return jsonResponse(request, { ok: true, attendances });
      },
    },
  },
});
