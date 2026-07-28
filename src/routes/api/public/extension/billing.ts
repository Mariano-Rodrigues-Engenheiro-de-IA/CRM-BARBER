// GET /api/public/extension/billing
// Retorna o plano atual da barbearia autenticada + uso e limites do plano grátis.

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

export const Route = createFileRoute("/api/public/extension/billing")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const { getBillingStatus } = await import("@/lib/billing.server");
        const billing = await getBillingStatus(supabaseAdmin, auth.token.barbershop_id);
        return jsonResponse(request, {
          ok: true,
          barbershop_id: auth.token.barbershop_id,
          billing,
        });
      },
    },
  },
});
