// POST /api/public/hooks/dispatch-jobs
//
// Chamado por pg_cron a cada minuto. Pega jobs pendentes agrupados por
// barbearia, respeitando:
//  - só barbearias com instância `connected`
//  - só campanhas não pausadas/canceladas
//  - `scheduled_for <= now()` e `expires_at > now()` (TTL 48h)
//  - até N jobs por barbearia por rodada (pace)
//
// Autenticação: header `apikey` = SUPABASE_PUBLISHABLE_KEY (padrão pg_cron).

import { createFileRoute } from "@tanstack/react-router";
import type { SendResult } from "@/lib/whatsapp/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { moveLeadToStage } from "@/lib/funnel-move.server";

const MAX_JOBS_PER_SHOP_PER_RUN = 4;
const DELAY_BETWEEN_SENDS_MS = 6000;
// Um job reivindicado (in_flight) que não recebeu desfecho em 6 min significa
// que a rodada anterior morreu no meio (timeout do worker / provider travado).
// Sem isso o job fica in_flight pra sempre e a campanha "trava".
const STALE_CLAIM_MS = 6 * 60 * 1000;
// Teto de tentativas: sem ele, um provider fora do ar (ex.: UAZAPI 503) gera
// retry infinito e a fila nunca fecha.
const MAX_ATTEMPTS = 8;
// Orçamento de tempo da rodada, pra encerrar antes do limite do worker.
const RUN_BUDGET_MS = 40_000;


export const Route = createFileRoute("/api/public/hooks/dispatch-jobs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey") ?? "";
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
        if (!apikey || apikey !== expected) {
          return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { getWhatsAppProviderByName } = await import("@/lib/whatsapp/provider.server");

        const runStartedAt = Date.now();
        const nowIso = new Date().toISOString();

        // Devolve pra fila os jobs travados em in_flight (rodada anterior morreu).
        await supabaseAdmin
          .from("message_jobs")
          .update({
            status: "pending",
            claimed_at: null,
            last_error: "Reagendado automaticamente após travar no envio",
            scheduled_for: nowIso,
          })
          .eq("status", "in_flight")
          .lt("claimed_at", new Date(Date.now() - STALE_CLAIM_MS).toISOString());

        // Expira jobs vencidos (limpeza barata).
        await supabaseAdmin
          .from("message_jobs")
          .update({ status: "expired" })
          .eq("status", "pending")
          .not("expires_at", "is", null)
          .lte("expires_at", nowIso);


        // Instâncias conectadas.
        const { data: instances } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("barbershop_id, provider, instance_token, phone_number_id, meta_access_token")
          .eq("status", "connected");

        if (!instances || instances.length === 0) {
          return jsonOk({ processed: 0, reason: "no connected instances" });
        }

        // Campanhas pausadas/canceladas.
        const { data: blocked } = await supabaseAdmin
          .from("campaigns")
          .select("id")
          .in("status", ["paused", "canceled"]);
        const blockedIds = new Set((blocked ?? []).map((c) => c.id));

        let totalSent = 0;
        let totalFailed = 0;

        for (const inst of instances) {
          const providerName = inst.provider === "meta" ? "meta" : "uazapi";
          const provider = getWhatsAppProviderByName(providerName);
          const instanceToken = providerName === "meta" ? inst.meta_access_token ?? inst.instance_token : inst.instance_token;
          if (!instanceToken) continue;
          // Busca uma amostra bem maior que o necessário — se não fizer
          // isso, uma campanha antiga pausada/cancelada com muitos jobs
          // pendentes sempre aparece entre "os mais antigos", o loop abaixo
          // pula todos eles um a um sem sobrar nenhum na amostra, e a
          // rodada inteira processa ZERO jobs, mesmo com campanhas novas e
          // válidas esperando atrás na fila. (Evitamos filtrar campaign_id
          // direto na query com NOT IN porque, em SQL, isso excluiria
          // silenciosamente jobs com campaign_id nulo, se algum existir.)
          const { data: jobs } = await supabaseAdmin
            .from("message_jobs")
            .select("id, customer_id, rendered_body, message_actions, template_name, template_language, template_header_media_path, template_carousel_media_paths, campaign_id, attempts")
            .eq("barbershop_id", inst.barbershop_id)
            .eq("status", "pending")
            // Jobs marcados force_extension nunca passam pela API oficial
            // (agendamento criado pelo ícone da conversa no WhatsApp) —
            // só a extensão do navegador envia esses.
            .eq("force_extension", false)
            .lte("scheduled_for", nowIso)
            .order("scheduled_for", { ascending: true })
            .limit(200);

          if (!jobs || jobs.length === 0) continue;

          let sentThisShop = 0;
          for (const job of jobs) {
            if (sentThisShop >= MAX_JOBS_PER_SHOP_PER_RUN) break;
            if (Date.now() - runStartedAt > RUN_BUDGET_MS) break;
            if (job.campaign_id && blockedIds.has(job.campaign_id)) continue;


            // Claim (compare-and-swap).
            const { data: claimed } = await supabaseAdmin
              .from("message_jobs")
              .update({
                status: "in_flight",
                attempts: (job.attempts ?? 0) + 1,
                claimed_at: new Date().toISOString(),
                last_error: null,
              })
              .eq("id", job.id)
              .eq("status", "pending")
              .select("id")
              .maybeSingle();
            if (!claimed) continue;

            // Prefer the phone snapshotted on the job; fall back to customer.
            let phone: string | null = null;
            const { data: jobRow } = await supabaseAdmin
              .from("message_jobs")
              .select("phone")
              .eq("id", job.id)
              .maybeSingle();
            phone = jobRow?.phone ?? null;
            if (!phone) {
              const { data: customer } = await supabaseAdmin
                .from("customers")
                .select("phone")
                .eq("id", job.customer_id)
                .eq("barbershop_id", inst.barbershop_id)
                .maybeSingle();
              phone = customer?.phone ?? null;
            }

            if (!phone) {
              await supabaseAdmin
                .from("message_jobs")
                .update({ status: "failed", last_error: "Cliente sem telefone" })
                .eq("id", job.id);
              totalFailed++;
              continue;
            }

            const attempts = (job.attempts ?? 0) + 1;

            // Nunca deixar uma exceção de rede matar a rodada com o job in_flight.
            let result: SendResult;

            if (job.template_name) {
              // Disparo via modelo aprovado (API oficial) — exige o
              // provider "meta" com sendTemplate implementado. UAZAPI não
              // suporta, dá erro claro em vez de mandar texto por engano
              // (a Cloud API rejeitaria mesmo, fora da janela de 24h).
              if (!provider.sendTemplate) {
                result = {
                  ok: false,
                  error: "Este provedor não suporta disparo de modelo (só a API oficial da Meta suporta).",
                  retryable: false,
                };
              } else {
                // Modelo com cabeçalho de imagem: a Meta exige a imagem
                // em TODO envio (não fica gravada no modelo aprovado) —
                // gera uma URL assinada aqui, na hora do disparo (não fica
                // salva pronta em lugar nenhum, pra não expirar antes do
                // TTL de 48h da campanha).
                let headerImageUrl: string | null = null;
                if (job.template_header_media_path) {
                  const { data: signed } = await supabaseAdmin.storage
                    .from("quick-reply-media")
                    .createSignedUrl(job.template_header_media_path, 60 * 60);
                  headerImageUrl = signed?.signedUrl ?? null;
                  if (!headerImageUrl) {
                    console.error(
                      "[dispatch-jobs] falha ao gerar URL assinada da imagem de cabeçalho do modelo:",
                      job.template_header_media_path,
                    );
                  }
                }
                // Mesma ideia pro CARROSSEL — uma URL assinada por cartão,
                // na mesma ordem salva em template_carousel_media_paths.
                let carouselCardImageUrls: string[] | null = null;
                if (job.template_carousel_media_paths?.length) {
                  const signedUrls = await Promise.all(
                    job.template_carousel_media_paths.map(async (path) => {
                      const { data: signed } = await supabaseAdmin.storage
                        .from("quick-reply-media")
                        .createSignedUrl(path, 60 * 60);
                      return signed?.signedUrl ?? null;
                    }),
                  );
                  if (signedUrls.some((u) => !u)) {
                    console.error(
                      "[dispatch-jobs] falha ao gerar URL assinada de ao menos um cartão do carrossel:",
                      job.template_carousel_media_paths,
                    );
                  }
                  carouselCardImageUrls = signedUrls.every((u) => u) ? (signedUrls as string[]) : null;
                }
                result = await provider
                  .sendTemplate({
                    instance_token: instanceToken,
                    phone_number_id: inst.phone_number_id ?? null,
                    to: phone,
                    template_name: job.template_name,
                    language_code: job.template_language ?? "pt_BR",
                    header_image_url: headerImageUrl,
                    carousel_card_image_urls: carouselCardImageUrls,
                  })
                  .catch((e: unknown) => ({
                    ok: false as const,
                    error: e instanceof Error ? e.message : "Falha de rede no envio",
                    retryable: true,
                  }));
              }
            } else {
            // Resposta Rápida com múltiplas mensagens sequenciais: envia
            // cada texto, em ordem, pro mesmo contato. Antes disso, o
            // disparo via servidor só mandava `rendered_body` (o primeiro
            // texto da sequência) e ignorava o resto — as demais mensagens
            // "sumiam" silenciosamente. Sem message_actions (caso comum,
            // mensagem única), cai no comportamento de sempre.
            const sequenceTexts = Array.isArray(job.message_actions)
              ? (job.message_actions as Array<{ type?: string; text?: string }>)
                  .filter((a) => a?.type === "text" && a.text?.trim())
                  .map((a) => String(a.text).trim())
              : [];
            const textsToSend = sequenceTexts.length > 0 ? sequenceTexts : [job.rendered_body];

            result = { ok: true };
            for (let i = 0; i < textsToSend.length; i += 1) {
              result = await provider
                .sendText({
                  instance_token: instanceToken,
                  phone_number_id: inst.phone_number_id ?? null,
                  to: phone,
                  text: textsToSend[i],
                })
                .catch((e: unknown) => ({
                  ok: false as const,
                  error: e instanceof Error ? e.message : "Falha de rede no envio",
                  retryable: true,
                }));
              if (!result.ok) break;
              // Pequena pausa entre as mensagens da MESMA sequência, pro
              // mesmo contato — mais curta que a pausa entre contatos
              // diferentes, só pra não chegar tudo colado instantaneamente.
              if (i < textsToSend.length - 1) await sleep(1500 + Math.random() * 1500);
            }
            }



            if (result.ok) {
              await supabaseAdmin
                .from("message_jobs")
                .update({
                  status: "sent",
                  sent_at: new Date().toISOString(),
                  // Antes isso ficava só espremido dentro de last_error
                  // como texto de debug — agora tem coluna própria de
                  // verdade, usada pra casar a resposta de um botão de
                  // confirmação (Agenda) de volta com este envio.
                  provider_message_id: result.provider_message_id ?? null,
                  last_error: null,
                })
                .eq("id", job.id);
              totalSent++;
              sentThisShop++;
              await supabaseAdmin.from("health_events").insert({
                barbershop_id: inst.barbershop_id,
                kind: "dispatch_sent",
                severity: "info",
                details: { job_id: job.id, provider_id: result.provider_message_id ?? null },
              });
              // Ações de funil (adicionar/mover/remover) — mesma regra da
              // extensão, aplicada direto no banco depois do envio, já que
              // o disparo em massa via servidor não passa pela extensão.
              const { data: customerRow } = await supabaseAdmin
                .from("customers")
                .select("name")
                .eq("id", job.customer_id)
                .eq("barbershop_id", inst.barbershop_id)
                .maybeSingle();
              try {
                await applyFunnelActionsServer(supabaseAdmin, inst.barbershop_id, job.message_actions, {
                  customerId: job.customer_id,
                  title: customerRow?.name || phone,
                  phone,
                });
              } catch (e) {
                console.error("[dispatch-jobs] falha ao aplicar ação de funil:", e);
              }
            } else {
              // Retry só até o teto; depois marca como falho pra fila não girar
              // eternamente com o provider fora do ar. Backoff cresce por tentativa.
              const willRetry = result.retryable && attempts < MAX_ATTEMPTS;
              const backoffMs = Math.min(attempts, 5) * 60_000;
              await supabaseAdmin
                .from("message_jobs")
                .update({
                  status: willRetry ? "pending" : "failed",
                  last_error: willRetry
                    ? result.error
                    : `${result.error} (após ${attempts} tentativa(s))`,
                  claimed_at: null,
                  scheduled_for: new Date(Date.now() + (willRetry ? backoffMs : 0)).toISOString(),
                })
                .eq("id", job.id);
              totalFailed++;
              await supabaseAdmin.from("health_events").insert({
                barbershop_id: inst.barbershop_id,
                kind: willRetry ? "dispatch_retry" : "dispatch_failed",
                severity: willRetry ? "warning" : "error",
                details: { job_id: job.id, error: result.error, attempts },
              });
            }


            // Pace humano entre envios da mesma barbearia.
            if (sentThisShop < MAX_JOBS_PER_SHOP_PER_RUN) {
              await sleep(DELAY_BETWEEN_SENDS_MS + Math.random() * 4000);
            }
          }
        }

        return jsonOk({ processed: totalSent + totalFailed, sent: totalSent, failed: totalFailed });
      },
    },
  },
});

function jsonOk(body: Record<string, unknown>) {
  return new Response(JSON.stringify({ ok: true, ...body }), {
    headers: { "Content-Type": "application/json" },
  });
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** Aplica as ações de funil (funnel_add/funnel_remove) de uma Resposta
 * Rápida direto no banco — versão server-side da mesma regra usada pela
 * extensão em applyFunnelActions (src/lib/wa-actions.ts): se o contato já
 * tem card no funil, só move de coluna; senão cria um novo. */
async function applyFunnelActionsServer(
  supabaseAdmin: SupabaseClient<Database>,
  barbershopId: string,
  actions: unknown,
  target: { customerId: string; title: string; phone: string },
) {
  if (!Array.isArray(actions)) return;
  const list = (actions as Array<{ type?: string; funnel_id?: string; stage_id?: string }>).filter(
    (a) => a?.type === "funnel_add" || a?.type === "funnel_remove",
  );
  if (list.length === 0) return;
  const digits = String(target.phone || "").replace(/\D/g, "");

  for (const a of list) {
    if (a.type === "funnel_add" && a.funnel_id && a.stage_id) {
      await moveLeadToStage(supabaseAdmin, barbershopId, {
        phone: target.phone,
        funnelId: a.funnel_id,
        stageId: a.stage_id,
        title: target.title,
        customerId: target.customerId,
      });
    } else if (a.type === "funnel_remove" && a.funnel_id) {
      await supabaseAdmin
        .from("funnel_cards")
        .delete()
        .eq("barbershop_id", barbershopId)
        .eq("funnel_id", a.funnel_id)
        .eq("phone", digits);
    }
  }
}
