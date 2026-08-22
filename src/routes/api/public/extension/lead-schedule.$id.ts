// DELETE /api/public/extension/lead-schedule/:id -> cancela um agendamento (só se ainda pendente)

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

export const Route = createFileRoute("/api/public/extension/lead-schedule/$id")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      DELETE: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const { error } = await supabaseAdmin
          .from("message_jobs")
          .delete()
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id)
          .eq("status", "pending");
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        return jsonResponse(request, { ok: true });
      },
    },
  },
});
