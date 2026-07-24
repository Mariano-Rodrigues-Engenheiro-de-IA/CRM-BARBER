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
        const { getWhatsAppProvider } = await import("@/lib/whatsapp/provider.server");
        const provider = getWhatsAppProvider();

        const nowIso = new Date().toISOString();

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
          .select("barbershop_id, instance_token")
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
          if (!inst.instance_token) continue;
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

            const { data: customer } = await supabaseAdmin
              .from("customers")
              .select("phone")
              .eq("id", job.customer_id)
              .eq("barbershop_id", inst.barbershop_id)
              .maybeSingle();

            if (!customer?.phone) {
              await supabaseAdmin
                .from("message_jobs")
                .update({ status: "failed", last_error: "Cliente sem telefone" })
                .eq("id", job.id);
              totalFailed++;
              continue;
            }

            const result = await provider.sendText({
              instance_token: inst.instance_token,
              to: customer.phone,
              text: job.rendered_body,
            });

            if (result.ok) {
              await supabaseAdmin
                .from("message_jobs")
                .update({
                  status: "sent",
                  sent_at: new Date().toISOString(),
                  provider_message_id: result.provider_message_id ?? null,
                })
                .eq("id", job.id);
              totalSent++;
              sentThisShop++;
            } else {
              await supabaseAdmin
                .from("message_jobs")
                .update({
                  status: result.retryable ? "pending" : "failed",
                  last_error: result.error,
                  scheduled_for: result.retryable
                    ? new Date(Date.now() + 60_000).toISOString()
                    : undefined,
                })
                .eq("id", job.id);
              totalFailed++;
            }

            // Pace humano entre envios da mesma barbearia.
            if (sentThisShop < MAX_JOBS_PER_SHOP_PER_RUN) {
              await sleep(DELAY_BETWEEN_SENDS_MS + Math.random() * 4000);
            }
          }
        }

        // Log de saúde.
        await supabaseAdmin.from("health_events").insert({
          event_type: "dispatcher_run",
          payload: { sent: totalSent, failed: totalFailed, at: new Date().toISOString() },
        });

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
