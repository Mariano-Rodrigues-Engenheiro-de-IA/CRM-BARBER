// GET  /api/public/extension/funnels -> funis com colunas e cards
// POST /api/public/extension/funnels -> cria funil (com colunas padrão)

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { funnelSchema } from "@/lib/funnels";

export const Route = createFileRoute("/api/public/extension/funnels")({
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

        const funnels = await supabaseAdmin
          .from("funnels")
          .select("id, name, mode, source_label_id, sort_order")
          .eq("barbershop_id", shop)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });

        const stages = await supabaseAdmin
          .from("funnel_stages")
          .select("id, funnel_id, name, color, sort_order")
          .eq("barbershop_id", shop)
          .order("sort_order", { ascending: true });

        let cards = await supabaseAdmin
          .from("funnel_cards")
          .select(
            "id, funnel_id, stage_id, title, phone, value_cents, notes, sort_order, customer_id, wa_contact_id, wa_contacts(wa_id, label_ids, profile_picture_url)",
          )
          .eq("barbershop_id", shop)
          .order("sort_order", { ascending: true });

        // Se a coluna profile_picture_url não existir, tenta sem ela
        if (cards.error?.message?.includes("profile_picture_url")) {
          cards = await supabaseAdmin
            .from("funnel_cards")
            .select(
              "id, funnel_id, stage_id, title, phone, value_cents, notes, sort_order, customer_id, wa_contact_id, wa_contacts(wa_id, label_ids)",
            )
            .eq("barbershop_id", shop)
            .order("sort_order", { ascending: true });
        }

        const error = funnels.error || stages.error || cards.error;
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }

        // wa_contacts(wa_id, label_ids) vem aninhado pelo relacionamento;
        // achata pra card.wa_id/card.label_ids diretos. wa_contact_id
        // sozinho é só o UUID interno, não serve pra abrir chat nem pra
        // saber a cor da etiqueta.
        const flatCards = (cards.data ?? []).map((c: any) => ({
          ...c,
          wa_id: c.wa_contacts?.wa_id ?? null,
          label_ids: c.wa_contacts?.label_ids ?? [],
          profile_picture_url: c.wa_contacts?.profile_picture_url ?? null,
          wa_contacts: undefined,
        }));

        const result = (funnels.data ?? []).map((f) => ({
          ...f,
          stages: (stages.data ?? []).filter((s) => s.funnel_id === f.id),
          cards: flatCards.filter((c) => c.funnel_id === f.id),
        }));
        return jsonResponse(request, { ok: true, funnels: result });
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
        const parsed = funnelSchema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: "Dados inválidos" }, { status: 400 });
        }
        const shop = auth.token.barbershop_id;

        const { count } = await supabaseAdmin
          .from("funnels")
          .select("id", { count: "exact", head: true })
          .eq("barbershop_id", shop);

        const { data: funnel, error } = await supabaseAdmin
          .from("funnels")
          .insert({
            barbershop_id: shop,
            name: parsed.data.name,
            mode: parsed.data.mode,
            source_label_id: parsed.data.source_label_id ?? null,
            sort_order: count ?? 0,
          })
          .select("id, name, mode, source_label_id, sort_order")
          .single();
        if (error || !funnel) {
          return jsonResponse(request, { ok: false, error: error?.message || "Erro" }, { status: 500 });
        }

        // Funil novo nasce sem etapas: o usuário monta as colunas depois.
        const names = parsed.data.stages ?? [];
        let stages: Array<Record<string, unknown>> = [];
        if (names.length) {
          const { data, error: stagesError } = await supabaseAdmin
            .from("funnel_stages")
            .insert(
              names.map((name, i) => ({
                barbershop_id: shop,
                funnel_id: funnel.id,
                name,
                sort_order: i,
              })),
            )
            .select("id, funnel_id, name, color, sort_order");
          if (stagesError) {
            return jsonResponse(request, { ok: false, error: stagesError.message }, { status: 500 });
          }
          stages = data ?? [];
        }


        return jsonResponse(request, {
          ok: true,
          funnel: { ...funnel, stages: stages ?? [], cards: [] },
        });
      },
    },
  },
});
