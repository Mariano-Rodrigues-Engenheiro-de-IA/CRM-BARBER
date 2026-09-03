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
  // Telefone real tem 10–13 dígitos. IDs @lid têm 15+.
  // Aceitamos IDs mais longos para evitar que contatos fiquem como 'null'.
  return digits.length >= 10 ? digits : null;
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
          // Listas que não vieram nessa varredura não existem mais no WhatsApp:
          // manter só o que está realmente sincronizado evita lista fantasma.
          await supabaseAdmin
            .from("wa_labels")
            .delete()
            .eq("barbershop_id", shop)
            .not(
              "wa_label_id",
              "in",
              `(${parsed.data.labels.map((l) => `"${l.id.replace(/"/g, "")}"`).join(",")})`,
            );
        }

        if (parsed.data.contacts.length) {
          // PostgREST exige que todas as linhas de um upsert em lote tenham
          // as MESMAS colunas — não dá pra misturar, numa mesma chamada,
          // contatos com profile_picture_url e contatos sem esse campo.
          // Por isso separa em dois grupos ANTES de montar os lotes: quem
          // veio com o campo (foto resolvida ou checada e vazia) e quem
          // veio sem (não foi verificado dessa vez — não pode sobrescrever
          // o que já está salvo com null).
          const withPhotoField = parsed.data.contacts.filter((c) => c.profile_picture_url !== undefined);
          const withoutPhotoField = parsed.data.contacts.filter((c) => c.profile_picture_url === undefined);

          async function upsertContacts(list: typeof withPhotoField, includePhoto: boolean) {
            // Lotes de 500 para não estourar o limite do PostgREST.
            for (let i = 0; i < list.length; i += 500) {
              const chunk = list.slice(i, i + 500).map((c) => ({
                barbershop_id: shop,
                wa_id: c.wa_id,
                // Nunca gravar ID interno (@lid) como telefone: só E.164 plausível.
                phone: normalizePhone(c.phone),
                name: c.name ?? null,
                is_group: !!c.is_group,
                label_ids: c.label_ids ?? [],
                last_message_at: c.last_message_at ?? null,
                ...(includePhoto ? { profile_picture_url: c.profile_picture_url ?? null } : {}),
                unread_count: c.unread_count ?? 0,
                synced_at: now,
              }));
              let { error } = await supabaseAdmin
                .from("wa_contacts")
                .upsert(chunk, { onConflict: "barbershop_id,wa_id" });

              // Se colunas novas não existirem ainda (migration pendente),
              // tenta de novo sem elas em vez de falhar a sincronização toda.
              if (error?.message?.includes("profile_picture_url")) {
                const safeChunk = chunk.map(({ profile_picture_url, ...rest }) => rest);
                const retry = await supabaseAdmin
                  .from("wa_contacts")
                  .upsert(safeChunk, { onConflict: "barbershop_id,wa_id" });
                error = retry.error;
              }
              if (error?.message?.includes("unread_count")) {
                const safeChunk = chunk.map(({ unread_count, ...rest }) => rest);
                const retry = await supabaseAdmin
                  .from("wa_contacts")
                  .upsert(safeChunk, { onConflict: "barbershop_id,wa_id" });
                error = retry.error;
              }

              if (error) return error.message;
            }
            return null;
          }

          const err1 = await upsertContacts(withPhotoField, true);
          if (err1) return jsonResponse(request, { ok: false, error: err1 }, { status: 500 });
          const err2 = await upsertContacts(withoutPhotoField, false);
          if (err2) return jsonResponse(request, { ok: false, error: err2 }, { status: 500 });

          // A coleta é um snapshot, não um acumulador. Contatos ausentes no
          // snapshot concluído deixam de compor Inbox/Listas imediatamente.
          const { error: staleError } = await supabaseAdmin
            .from("wa_contacts")
            .delete()
            .eq("barbershop_id", shop)
            .lt("synced_at", now);
          if (staleError) {
            return jsonResponse(request, { ok: false, error: staleError.message }, { status: 500 });
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
