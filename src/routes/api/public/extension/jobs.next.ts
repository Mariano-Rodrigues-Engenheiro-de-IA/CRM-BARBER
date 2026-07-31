// GET /api/public/extension/jobs/next
//
// Returns the next pending message job for the token's barbershop,
// respecting `scheduled_for <= now()` and skipping jobs whose
// `expires_at <= now()` (48h TTL rule from the approved plan).
//
// The endpoint atomically flips the job to `in_flight` so parallel
// extension polls don't grab the same job. If nothing is available,
// returns `{ ok: true, job: null }`.

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

export const Route = createFileRoute("/api/public/extension/jobs/next")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }

        // Se a barbearia já tem instância WhatsApp conectada via servidor
        // (UAZAPI/etc), o dispatcher server-side envia; a extensão só serve
        // como ponte visual. Devolve `null` pra ela ficar quieta.
        const { data: srvInstance } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("status")
          .eq("barbershop_id", auth.token.barbershop_id)
          .maybeSingle();
        if (srvInstance && srvInstance.status === "connected") {
          return jsonResponse(request, { ok: true, job: null, reason: "server_dispatch" });
        }

        const nowIso = new Date().toISOString();
        const staleClaimIso = new Date(Date.now() - 6 * 60 * 1000).toISOString();

        // MV3 service workers can be terminated between claiming and reporting.
        // Without this, a job can remain `in_flight` forever and the campaign
        // appears stopped. Keep the window above the silent-send ack timeout,
        // otherwise a slow WhatsApp ack could be requeued while still sending.
        // Requeue only old claims from this barbershop.
        await supabaseAdmin
          .from("message_jobs")
          .update({
            status: "pending",
            claimed_at: null,
            claimed_by_token: null,
            last_error: "Reagendado automaticamente após travar no envio",
          })
          .eq("barbershop_id", auth.token.barbershop_id)
          .eq("status", "in_flight")
          .lt("claimed_at", staleClaimIso);

        // Expire old jobs first (batch, cheap). expires_at is nullable in the
        // schema — only expire jobs that actually carry a TTL.
        await supabaseAdmin
          .from("message_jobs")
          .update({ status: "expired" })
          .eq("barbershop_id", auth.token.barbershop_id)
          .eq("status", "pending")
          .not("expires_at", "is", null)
          .lte("expires_at", nowIso);

        // Descobre campanhas pausadas/canceladas — jobs dessas ficam de fora.
        const { data: blockedCampaigns } = await supabaseAdmin
          .from("campaigns")
          .select("id")
          .eq("barbershop_id", auth.token.barbershop_id)
          .in("status", ["paused", "canceled"]);
        const blockedIds = (blockedCampaigns ?? []).map((c) => c.id);

        // Pick the oldest pending job that's due. Skip jobs whose TTL has
        // passed; jobs without expires_at are treated as non-expiring.
        let pickQ = supabaseAdmin
          .from("message_jobs")
          .select("id, customer_id, rendered_body, message_actions, scheduled_for, attempts, expires_at, campaign_id")
          .eq("barbershop_id", auth.token.barbershop_id)
          .eq("status", "pending")
          .lte("scheduled_for", nowIso);
        if (blockedIds.length > 0) {
          pickQ = pickQ.not("campaign_id", "in", `(${blockedIds.join(",")})`);
        }
        const { data: candidate, error: pickErr } = await pickQ
          .order("scheduled_for", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (pickErr) {
          return jsonResponse(request, { ok: false, error: "Query failed" }, { status: 500 });
        }
        if (!candidate) return jsonResponse(request, { ok: true, job: null });

        // Claim it (compare-and-swap on status).
        const { data: claimed, error: claimErr } = await supabaseAdmin
          .from("message_jobs")
          .update({
            status: "in_flight",
            attempts: candidate.attempts + 1,
            claimed_at: nowIso,
            claimed_by_token: auth.token.id,
            last_error: null,
          })
          .eq("id", candidate.id)
          .eq("status", "pending")
          .select("id, customer_id, rendered_body, message_actions, scheduled_for, attempts")
          .maybeSingle();
        if (claimErr) {
          return jsonResponse(request, { ok: false, error: "Claim failed" }, { status: 500 });
        }
        if (!claimed) {
          // Someone else grabbed it between pick and claim; ask extension to retry.
          return jsonResponse(request, { ok: true, job: null });
        }

        // Enrich with customer phone.
        const { data: customer } = await supabaseAdmin
          .from("customers")
          .select("id, name, phone")
          .eq("id", claimed.customer_id)
          .eq("barbershop_id", auth.token.barbershop_id)
          .single();

        return jsonResponse(request, {
          ok: true,
          job: {
            id: claimed.id,
            body: claimed.rendered_body,
            actions: claimed.message_actions,
            attempts: claimed.attempts,
            customer: customer ?? null,
          },
        });
      },
    },
  },
});
