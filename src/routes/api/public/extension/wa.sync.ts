// POST /api/public/extension/wa/sync
// A extensão manda as etiquetas e os contatos/conversas lidos do WhatsApp Web.
// Fazemos upsert por (barbershop_id, wa_label_id) e (barbershop_id, wa_id).

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { waSyncSchema } from "@/lib/funnels";

/** Telefone real tem 10–13 dígitos; LIDs do WhatsApp têm 15+. */
function normalizePhone(raw: string | null | undefined) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 13 ? digits : null;
}

export const Route = createFileRoute("/api/public/extension/wa/sync")({
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
        const parsed = waSyncSchema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: "Dados inválidos" }, { status: 400 });
        }
        const shop = auth.token.barbershop_id;
        const now = new Date().toISOString();

        if (parsed.data.labels.length) {
          const { error } = await supabaseAdmin.from("wa_labels").upsert(
            parsed.data.labels.map((l) => ({
              barbershop_id: shop,
              wa_label_id: l.id,
              name: l.name,
              color: l.color ?? null,
              conversation_count: l.count ?? 0,
              synced_at: now,
            })),
            { onConflict: "barbershop_id,wa_label_id" },
          );
          if (error) {
            return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
          }
        }

        if (parsed.data.contacts.length) {
          // Lotes de 500 para não estourar o limite do PostgREST.
          for (let i = 0; i < parsed.data.contacts.length; i += 500) {
            const chunk = parsed.data.contacts.slice(i, i + 500).map((c) => ({
              barbershop_id: shop,
              wa_id: c.wa_id,
              // Nunca gravar ID interno (@lid) como telefone: só E.164 plausível.
              phone: normalizePhone(c.phone),
              name: c.name ?? null,
              is_group: !!c.is_group,
              label_ids: c.label_ids ?? [],
              last_message_at: c.last_message_at ?? null,
              synced_at: now,
            }));
            const { error } = await supabaseAdmin
              .from("wa_contacts")
              .upsert(chunk, { onConflict: "barbershop_id,wa_id" });
            if (error) {
              return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
            }
          }
        }

        return jsonResponse(request, {
          ok: true,
          labels: parsed.data.labels.length,
          contacts: parsed.data.contacts.length,
          synced_at: now,
        });
      },
    },
  },
});
