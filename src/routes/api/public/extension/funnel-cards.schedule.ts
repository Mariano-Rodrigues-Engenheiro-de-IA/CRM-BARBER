// POST /api/public/extension/funnel-cards/schedule
// Agenda (ou enfileira) uma mensagem para o lead de um card de funil.
//
// Cards de funil não são necessariamente assinantes. Para reaproveitar a fila
// existente (message_jobs exige customer_id), reutilizamos um cliente com o
// mesmo telefone ou criamos um cliente arquivado (source = "funil"), que não
// aparece nos kanbans de assinaturas.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const schema = z.object({
  card_id: z.string().uuid(),
  message: z.string().trim().min(1).max(4000),
  scheduled_for: z.string().min(4).max(40).optional(),
});

const TTL_HOURS = 48;

export const Route = createFileRoute("/api/public/extension/funnel-cards/schedule")({
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
        const parsed = schema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: "Dados inválidos" }, { status: 400 });
        }
        const shop = auth.token.barbershop_id;

        const { data: card } = await supabaseAdmin
          .from("funnel_cards")
          .select("id, title, phone, customer_id")
          .eq("id", parsed.data.card_id)
          .eq("barbershop_id", shop)
          .maybeSingle();
        if (!card) {
          return jsonResponse(request, { ok: false, error: "Card não encontrado" }, { status: 404 });
        }

        const phone = String(card.phone ?? "").replace(/\D/g, "");
        if (!/^\d{10,15}$/.test(phone)) {
          return jsonResponse(
            request,
            { ok: false, error: "Este lead não tem telefone válido" },
            { status: 400 },
          );
        }

        let customerId = card.customer_id as string | null;
        if (!customerId) {
          const { data: existing } = await supabaseAdmin
            .from("customers")
            .select("id")
            .eq("barbershop_id", shop)
            .eq("phone", phone)
            .maybeSingle();
          if (existing) {
            customerId = existing.id;
          } else {
            const { data: created, error: cErr } = await supabaseAdmin
              .from("customers")
              .insert({
                barbershop_id: shop,
                name: card.title,
                phone,
                status: "lead",
                source: "funil",
                archived_at: new Date().toISOString(),
              })
              .select("id")
              .single();
            if (cErr || !created) {
              return jsonResponse(
                request,
                { ok: false, error: cErr?.message ?? "Falha ao registrar lead" },
                { status: 500 },
              );
            }
            customerId = created.id;
          }
          await supabaseAdmin
            .from("funnel_cards")
            .update({ customer_id: customerId })
            .eq("id", card.id)
            .eq("barbershop_id", shop);
        }

        const when = parsed.data.scheduled_for ? Date.parse(parsed.data.scheduled_for) : Date.now();
        if (Number.isNaN(when)) {
          return jsonResponse(request, { ok: false, error: "Data inválida" }, { status: 400 });
        }
        const scheduled = Math.max(when, Date.now());

        const { error: jErr } = await supabaseAdmin.from("message_jobs").insert({
          barbershop_id: shop,
          customer_id: customerId,
          phone,
          rendered_body: parsed.data.message.trim(),
          status: "pending",
          scheduled_for: new Date(scheduled).toISOString(),
          expires_at: new Date(scheduled + TTL_HOURS * 3600 * 1000).toISOString(),
        });
        if (jErr) {
          return jsonResponse(request, { ok: false, error: jErr.message }, { status: 500 });
        }

        return jsonResponse(request, { ok: true, scheduled_for: new Date(scheduled).toISOString() });
      },
    },
  },
});
