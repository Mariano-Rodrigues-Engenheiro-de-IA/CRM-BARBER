// POST /api/public/extension/postsale-ensure -> garante que o funil
// especial "Pós-venda" + etapa "Atendidos" existam, mesmo que ninguém
// nunca tenha marcado um atendimento ainda.
//
// Chamada pela tela de configuração (Pós-venda/Retorno) ao abrir —
// pedido explícito do usuário (22/09): a configuração precisa poder
// ser feita ANTES do primeiro atendimento marcado, não depois. Sem
// isso, o dono só conseguiria configurar a mensagem depois de já ter
// perdido a chance de mandar pro primeiro cliente atendido.

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { ensurePostsaleFunnel } from "@/lib/postsale-funnel.server";

export const Route = createFileRoute("/api/public/extension/postsale-ensure")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const shop = auth.token.barbershop_id;

        const { getBillingStatus } = await import("@/lib/billing.server");
        const billing = await getBillingStatus(supabaseAdmin, shop);
        if (!billing.premium) {
          return jsonResponse(
            request,
            { ok: false, error: "Pós-venda faz parte do plano Premium." },
            { status: 402 },
          );
        }

        const ensured = await ensurePostsaleFunnel(supabaseAdmin, shop);
        if ("error" in ensured) {
          return jsonResponse(request, { ok: false, error: ensured.error }, { status: 500 });
        }

        return jsonResponse(request, {
          ok: true,
          funnel_id: ensured.funnel.id,
          stage_id: ensured.stage.id,
        });
      },
    },
  },
});
