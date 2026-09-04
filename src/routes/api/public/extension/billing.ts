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
        // Nicho da conta (barbearia, odontologia...) — aproveitando essa
        // rota, que já é buscada uma vez no carregamento do painel, em vez
        // de criar outra chamada só pra isso.
        const { data: shop } = await supabaseAdmin
          .from("barbershops")
          .select("business_type")
          .eq("id", auth.token.barbershop_id)
          .maybeSingle();
        return jsonResponse(request, {
          ok: true,
          barbershop_id: auth.token.barbershop_id,
          business_type: shop?.business_type ?? "barbearia",
          billing,
        });
      },
    },
  },
});
