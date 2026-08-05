// POST   /api/public/extension/funnel-cards -> cria card
// PATCH  /api/public/extension/funnel-cards -> move/edita card (id no corpo)
// DELETE /api/public/extension/funnel-cards -> remove card (id no corpo)

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { cardCreateSchema, cardPatchSchema } from "@/lib/funnels";

const deleteSchema = z.object({ id: z.string().uuid() });

/** Telefone real tem 10–13 dígitos; IDs internos (@lid) têm 15+ e são descartados. */
function normalizePhone(raw: string | null | undefined) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 13 ? digits : null;
}

export const Route = createFileRoute("/api/public/extension/funnel-cards")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

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
        const parsed = cardCreateSchema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: "Dados inválidos" }, { status: 400 });
        }
        const shop = auth.token.barbershop_id;

        const { data: stage } = await supabaseAdmin
          .from("funnel_stages")
          .select("id")
          .eq("id", parsed.data.stage_id)
          .eq("funnel_id", parsed.data.funnel_id)
          .eq("barbershop_id", shop)
          .maybeSingle();
        if (!stage) {
          return jsonResponse(request, { ok: false, error: "Coluna não encontrada" }, { status: 404 });
        }

        // Idempotência: o mesmo contato só pode ter um card por funil
        // (constraint funnel_cards_unique_contact). Se já existir, apenas
        // movemos para a coluna alvo em vez de tentar inserir de novo.
        if (parsed.data.wa_contact_id) {
          let existingRes = await supabaseAdmin
            .from("funnel_cards")
            .select(
              "id, funnel_id, stage_id, title, phone, value_cents, notes, sort_order, customer_id, wa_contact_id, wa_contacts(wa_id, label_ids, profile_picture_url, unread_count)",
            )
            .eq("barbershop_id", shop)
            .eq("funnel_id", parsed.data.funnel_id)
            .eq("wa_contact_id", parsed.data.wa_contact_id)
            .maybeSingle();

          if (existingRes.error?.message?.includes("unread_count")) {
            existingRes = await supabaseAdmin
              .from("funnel_cards")
              .select(
                "id, funnel_id, stage_id, title, phone, value_cents, notes, sort_order, customer_id, wa_contact_id, wa_contacts(wa_id, label_ids, profile_picture_url)",
              )
              .eq("barbershop_id", shop)
              .eq("funnel_id", parsed.data.funnel_id)
              .eq("wa_contact_id", parsed.data.wa_contact_id)
              .maybeSingle();
          }
          if (existingRes.error?.message?.includes("profile_picture_url")) {
            existingRes = await supabaseAdmin
              .from("funnel_cards")
              .select(
                "id, funnel_id, stage_id, title, phone, value_cents, notes, sort_order, customer_id, wa_contact_id, wa_contacts(wa_id, label_ids)",
              )
              .eq("barbershop_id", shop)
              .eq("funnel_id", parsed.data.funnel_id)
              .eq("wa_contact_id", parsed.data.wa_contact_id)
              .maybeSingle();
          }

          const existing = existingRes.data;
          if (existing) {
            const { wa_contacts, ...rest } = existing as any;
            if (existing.stage_id !== parsed.data.stage_id) {
              const { error: moveError } = await supabaseAdmin
                .from("funnel_cards")
                .update({ stage_id: parsed.data.stage_id })
                .eq("id", existing.id)
                .eq("barbershop_id", shop);
              if (moveError) {
                return jsonResponse(request, { ok: false, error: moveError.message }, { status: 500 });
              }
            }
            return jsonResponse(request, {
              ok: true,
              card: {
                ...rest,
                wa_id: wa_contacts?.wa_id ?? null,
                label_ids: wa_contacts?.label_ids ?? [],
                profile_picture_url: wa_contacts?.profile_picture_url ?? null,
                unread_count: wa_contacts?.unread_count ?? 0,
                stage_id: parsed.data.stage_id,
              },
            });
          }
        }

        const { count } = await supabaseAdmin
          .from("funnel_cards")
          .select("id", { count: "exact", head: true })
          .eq("stage_id", parsed.data.stage_id);


        const insertPayload = {
          barbershop_id: shop,
          funnel_id: parsed.data.funnel_id,
          stage_id: parsed.data.stage_id,
          title: parsed.data.title,
          phone: normalizePhone(parsed.data.phone),
          value_cents: parsed.data.value_cents ?? null,
          notes: parsed.data.notes ?? null,
          customer_id: parsed.data.customer_id ?? null,
          wa_contact_id: parsed.data.wa_contact_id ?? null,
          sort_order: count ?? 0,
        };

        let insertRes = await supabaseAdmin
          .from("funnel_cards")
          .insert(insertPayload)
          .select(
            "id, funnel_id, stage_id, title, phone, value_cents, notes, sort_order, customer_id, wa_contact_id, wa_contacts(wa_id, label_ids, profile_picture_url, unread_count)",
          )
          .single();

        if (insertRes.error?.message?.includes("unread_count")) {
          insertRes = await supabaseAdmin
            .from("funnel_cards")
            .insert(insertPayload)
            .select(
              "id, funnel_id, stage_id, title, phone, value_cents, notes, sort_order, customer_id, wa_contact_id, wa_contacts(wa_id, label_ids, profile_picture_url)",
            )
            .single();
        }
        if (insertRes.error?.message?.includes("profile_picture_url")) {
          insertRes = await supabaseAdmin
            .from("funnel_cards")
            .insert(insertPayload)
            .select(
              "id, funnel_id, stage_id, title, phone, value_cents, notes, sort_order, customer_id, wa_contact_id, wa_contacts(wa_id, label_ids)",
            )
            .single();
        }

        const { data, error } = insertRes;
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        const { wa_contacts, ...rest } = (data ?? {}) as any;
        return jsonResponse(request, {
          ok: true,
          card: {
            ...rest,
            wa_id: wa_contacts?.wa_id ?? null,
            label_ids: wa_contacts?.label_ids ?? [],
            profile_picture_url: wa_contacts?.profile_picture_url ?? null,
            unread_count: wa_contacts?.unread_count ?? 0,
          },
        });
      },

      PATCH: async ({ request }) => {
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
        const parsed = cardPatchSchema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: "Dados inválidos" }, { status: 400 });
        }
        const { id, ...rest } = parsed.data;
        const patch: {
          stage_id?: string;
          sort_order?: number;
          title?: string;
          phone?: string | null;
          value_cents?: number | null;
          notes?: string | null;
        } = {};
        if (rest.stage_id !== undefined) patch.stage_id = rest.stage_id;
        if (rest.sort_order !== undefined) patch.sort_order = rest.sort_order;
        if (rest.title !== undefined) patch.title = rest.title;
        if (rest.phone !== undefined) patch.phone = normalizePhone(rest.phone);
        if (rest.value_cents !== undefined) patch.value_cents = rest.value_cents;
        if (rest.notes !== undefined) patch.notes = rest.notes;

        const { error } = await supabaseAdmin
          .from("funnel_cards")
          .update(patch)
          .eq("id", id)
          .eq("barbershop_id", auth.token.barbershop_id);
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        return jsonResponse(request, { ok: true });
      },

      DELETE: async ({ request }) => {
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
        const parsed = deleteSchema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: "Dados inválidos" }, { status: 400 });
        }
        const { error } = await supabaseAdmin
          .from("funnel_cards")
          .delete()
          .eq("id", parsed.data.id)
          .eq("barbershop_id", auth.token.barbershop_id);
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        return jsonResponse(request, { ok: true });
      },
    },
  },
});
