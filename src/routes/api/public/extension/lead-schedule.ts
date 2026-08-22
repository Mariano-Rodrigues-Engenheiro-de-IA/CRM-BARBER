// GET  /api/public/extension/lead-schedule?wa_contact_id=X | ?phone=Y -> lista pendentes
// POST /api/public/extension/lead-schedule -> agenda uma mensagem pro contato
//
// Mesma fila (message_jobs) já usada pelo agendamento dentro do funil — só
// que aqui resolve o cliente direto pelo telefone, sem precisar que o lead
// já esteja num card de funil. Por isso funciona no ícone da conversa do
// WhatsApp pra qualquer contato.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { quickReplyActionSchema } from "@/lib/quick-replies";

const postSchema = z.object({
  wa_contact_id: z.string().uuid().nullable().optional(),
  phone: z.string().trim().min(8).max(30),
  name: z.string().trim().max(160).nullable().optional(),
  message: z.string().trim().max(4000).optional(),
  // Passos ricos (texto/imagem/áudio/vídeo) — quando presente, tem
  // prioridade sobre `message`; permite mandar mídia ou reaproveitar uma
  // resposta rápida já pronta no agendamento.
  actions: z.array(quickReplyActionSchema).min(1).max(10).optional(),
  scheduled_for: z.string().min(4).max(40).optional(),
}).refine((d) => !!d.message?.trim() || !!d.actions?.length, { message: "Escreva uma mensagem ou escolha o conteúdo" });

const TTL_HOURS = 48;

export const Route = createFileRoute("/api/public/extension/lead-schedule")({
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
        const phone = url.searchParams.get("phone")?.replace(/\D/g, "");
        if (!phone) return jsonResponse(request, { ok: true, jobs: [] });

        const { data, error } = await supabaseAdmin
          .from("message_jobs")
          .select("id, rendered_body, message_actions, scheduled_for, status, sent_at, last_error")
          .eq("barbershop_id", shop)
          .eq("phone", phone)
          // Só o que foi criado por aqui (agendamento pelo ícone da
          // conversa) — disparos de campanha do CRM usam campaign_id e não
          // devem aparecer misturados nessa lista.
          .is("campaign_id", null)
          .in("status", ["pending", "sent", "failed"])
          .order("scheduled_for", { ascending: true })
          .limit(50);
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        // Resolve uma URL assinada fresca pra cada ação com mídia, pra dar
        // pra pré-visualizar na lista (imagem/áudio/vídeo).
        const jobs = await Promise.all(
          (data ?? []).map(async (j) => {
            const actions = (j.message_actions as Array<Record<string, unknown>>) ?? [];
            const withUrls = await Promise.all(
              actions.map(async (a) => {
                if (!a?.path || typeof a.path !== "string") return a;
                const { data: signed } = await supabaseAdmin.storage
                  .from("quick-reply-media")
                  .createSignedUrl(a.path, 3600);
                return { ...a, url: signed?.signedUrl ?? null };
              }),
            );
            return { ...j, message_actions: withUrls };
          }),
        );
        return jsonResponse(request, { ok: true, jobs });
      },

      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const shop = auth.token.barbershop_id;
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return jsonResponse(request, { ok: false, error: "Invalid JSON" }, { status: 400 });
        }
        const parsed = postSchema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
        }
        const phone = parsed.data.phone.replace(/\D/g, "");
        if (!/^\d{10,15}$/.test(phone)) {
          return jsonResponse(request, { ok: false, error: "Telefone inválido" }, { status: 400 });
        }

        // Mesma estratégia do agendamento por card: reaproveita um
        // cliente com o mesmo telefone, ou cria um arquivado (não aparece
        // nos kanbans de assinatura) só pra ter onde pendurar a fila.
        let customerId: string | null = null;
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
              name: parsed.data.name || phone,
              phone,
              status: "lead",
              source: "whatsapp_extension",
              archived_at: new Date().toISOString(),
            })
            .select("id")
            .single();
          if (cErr || !created) {
            return jsonResponse(request, { ok: false, error: cErr?.message ?? "Falha ao registrar lead" }, { status: 500 });
          }
          customerId = created.id;
        }

        const when = parsed.data.scheduled_for ? Date.parse(parsed.data.scheduled_for) : Date.now();
        if (Number.isNaN(when)) {
          return jsonResponse(request, { ok: false, error: "Data inválida" }, { status: 400 });
        }
        const scheduled = Math.max(when, Date.now());

        // Preview de lista: primeiro texto disponível entre as ações, ou
        // a mensagem simples, ou um rótulo genérico pra mídia sem legenda.
        const firstText = parsed.data.actions?.find((a) => a.type === "text")?.text;
        const renderedBody = (parsed.data.message?.trim() || firstText || "[Mídia]").slice(0, 4000);

        const { data: job, error: jErr } = await supabaseAdmin
          .from("message_jobs")
          .insert({
            barbershop_id: shop,
            customer_id: customerId,
            phone,
            rendered_body: renderedBody,
            message_actions: parsed.data.actions ?? (parsed.data.message ? [{ type: "text", text: parsed.data.message.trim() }] : []),
            status: "pending",
            scheduled_for: new Date(scheduled).toISOString(),
            expires_at: new Date(scheduled + TTL_HOURS * 3600 * 1000).toISOString(),
            // Sempre vai pela extensão — não depende de conexão oficial
            // (que pode estar com token inválido/expirado sem o usuário
            // saber, travando o envio em silêncio).
            force_extension: true,
          })
          .select("id, rendered_body, message_actions, scheduled_for, status")
          .single();
        if (jErr) return jsonResponse(request, { ok: false, error: jErr.message }, { status: 500 });

        return jsonResponse(request, { ok: true, job });
      },
    },
  },
});
