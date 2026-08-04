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
          const { data: jobs } = await supabaseAdmin
            .from("message_jobs")
            .select("id, customer_id, rendered_body, campaign_id, attempts")
            .eq("barbershop_id", inst.barbershop_id)
            .eq("status", "pending")
            .lte("scheduled_for", nowIso)
            .order("scheduled_for", { ascending: true })
            .limit(MAX_JOBS_PER_SHOP_PER_RUN * 2);

          if (!jobs || jobs.length === 0) continue;

          let sentThisShop = 0;
          for (const job of jobs) {
            if (sentThisShop >= MAX_JOBS_PER_SHOP_PER_RUN) break;
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

            const result = await provider.sendText({
              instance_token: instanceToken,
              phone_number_id: inst.phone_number_id ?? null,
              to: phone,
              text: job.rendered_body,
            });

            if (result.ok) {
              await supabaseAdmin
                .from("message_jobs")
                .update({
                  status: "sent",
                  sent_at: new Date().toISOString(),
                  last_error: result.provider_message_id
                    ? `provider_id:${result.provider_message_id}`
                    : null,
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
            } else {
              await supabaseAdmin
                .from("message_jobs")
                .update({
                  status: result.retryable ? "pending" : "failed",
                  last_error: result.error,
                  scheduled_for: result.retryable
                    ? new Date(Date.now() + 60_000).toISOString()
                    : new Date().toISOString(),
                })
                .eq("id", job.id);
              totalFailed++;
              await supabaseAdmin.from("health_events").insert({
                barbershop_id: inst.barbershop_id,
                kind: result.retryable ? "dispatch_retry" : "dispatch_failed",
                severity: result.retryable ? "warning" : "error",
                details: { job_id: job.id, error: result.error },
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
