// GET /api/public/extension/agente-ia-access-link -> gera um link mágico
// de acesso ao painel do Agente de IA (IA-BARBER-AGENDA), pra abrir sem
// precisar logar de novo lá.

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

export const Route = createFileRoute("/api/public/extension/agente-ia-access-link")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }

        const bridgeSecret = process.env.CRM_BRIDGE_SHARED_SECRET;
        const bridgeUrl = process.env.AI_BRIDGE_URL_SSO; // ex: https://bazfkghkipqamnksbrdz.supabase.co/functions/v1/sso-access-link
        if (!bridgeSecret || !bridgeUrl) {
          return jsonResponse(request, { ok: false, error: "Ponte com a IA não configurada." }, { status: 500 });
        }

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);
          const res = await fetch(bridgeUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-shared-secret": bridgeSecret },
            body: JSON.stringify({ barbershop_id: auth.token.barbershop_id }),
            signal: controller.signal,
          }).finally(() => clearTimeout(timeout));
          const data = await res.json().catch(() => null);
          if (!res.ok || !data?.action_link) {
            return jsonResponse(
              request,
              { ok: false, error: data?.message || data?.error || "Não foi possível gerar o acesso agora." },
              { status: 502 },
            );
          }
          return jsonResponse(request, { ok: true, action_link: data.action_link });
        } catch (e) {
          return jsonResponse(request, { ok: false, error: "Tempo esgotado ao gerar o acesso." }, { status: 504 });
        }
      },
    },
  },
});
