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

        const nowIso = new Date().toISOString();

        // Expire old jobs first (batch, cheap).
        await supabaseAdmin
          .from("message_jobs")
          .update({ status: "expired" })
          .eq("barbershop_id", auth.token.barbershop_id)
          .eq("status", "pending")
          .lte("expires_at", nowIso);

        // Pick the oldest pending job that's due.
        const { data: candidate, error: pickErr } = await supabaseAdmin
          .from("message_jobs")
          .select("id, customer_id, rendered_body, scheduled_for, attempts, expires_at")
          .eq("barbershop_id", auth.token.barbershop_id)
          .eq("status", "pending")
          .lte("scheduled_for", nowIso)
          .gt("expires_at", nowIso)
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
          .update({ status: "in_flight", attempts: candidate.attempts + 1 })
          .eq("id", candidate.id)
          .eq("status", "pending")
          .select("id, customer_id, rendered_body, scheduled_for, attempts")
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
            attempts: claimed.attempts,
            customer: customer ?? null,
          },
        });
      },
    },
  },
});
