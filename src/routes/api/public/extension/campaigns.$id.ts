// PATCH  /api/public/extension/campaigns/:id -> status: running|paused|canceled
// DELETE /api/public/extension/campaigns/:id -> apaga campanha + jobs + targets
// Enquanto 'paused', /jobs/next não devolve jobs desta campanha.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const patchSchema = z.object({
  status: z.enum(["running", "paused", "canceled"]),
});

export const Route = createFileRoute("/api/public/extension/campaigns/$id")({
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
        const parsed = patchSchema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(
            request,
            { ok: false, error: "Invalid body", details: parsed.error.flatten() },
            { status: 400 },
          );
        }
        const { data, error } = await supabaseAdmin
          .from("campaigns")
          .update({ status: parsed.data.status })
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id)
          .select("id, name, status")
          .maybeSingle();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        if (!data) {
          return jsonResponse(request, { ok: false, error: "Not found" }, { status: 404 });
        }
        return jsonResponse(request, { ok: true, campaign: data });
      },

      DELETE: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        // Confirma tenant antes de apagar
        const { data: found } = await supabaseAdmin
          .from("campaigns")
          .select("id")
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id)
          .maybeSingle();
        if (!found) {
          return jsonResponse(request, { ok: false, error: "Not found" }, { status: 404 });
        }
        await supabaseAdmin.from("message_jobs").delete()
          .eq("campaign_id", params.id).eq("barbershop_id", auth.token.barbershop_id);
        await supabaseAdmin.from("campaign_targets").delete()
          .eq("campaign_id", params.id).eq("barbershop_id", auth.token.barbershop_id);
        const { error } = await supabaseAdmin.from("campaigns").delete()
          .eq("id", params.id).eq("barbershop_id", auth.token.barbershop_id);
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true });
      },
    },
  },
});
