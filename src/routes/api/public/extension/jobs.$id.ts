// PATCH /api/public/extension/jobs/:id
//
// The extension reports the outcome of a job it previously claimed.
// Body: { status: "sent" | "failed", error?: string }
//
// Tenant isolation: the update is scoped to the token's barbershop_id,
// so an attacker holding token of shop A cannot flip status of shop B's jobs.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const bodySchema = z.object({
  status: z.enum(["sent", "failed"]),
  error: z.string().max(500).optional(),
});

export const Route = createFileRoute("/api/public/extension/jobs/$id")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      PATCH: async ({ request, params }) => {
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
        const parsed = bodySchema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: "Invalid body" }, { status: 400 });
        }

        const nowIso = new Date().toISOString();
        const patch = {
          status: parsed.data.status,
          last_error: parsed.data.error ?? null,
          sent_at: parsed.data.status === "sent" ? nowIso : null,
        };

        const { data, error } = await supabaseAdmin
          .from("message_jobs")
          .update(patch)
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id) // tenant guard
          .select("id, status")
          .maybeSingle();

        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        if (!data) {
          // Either wrong id, or the job belongs to another barbershop.
          return jsonResponse(request, { ok: false, error: "Job não encontrado" }, { status: 404 });
        }
        return jsonResponse(request, { ok: true, job: data });
      },
    },
  },
});
