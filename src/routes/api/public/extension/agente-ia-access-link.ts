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
          // 8s era curto demais (mesmo achado da ponte com a ATENDIMENTO)
          // - gerar o link magico envolve mais de uma chamada do lado da
          // AGENDA, e uma funcao "fria" pode facilmente passar de 8s.
          const timeout = setTimeout(() => controller.abort(), 20000);
          const res = await fetch(bridgeUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-shared-secret": bridgeSecret },
            body: JSON.stringify({ barbershop_id: auth.token.barbershop_id }),
            signal: controller.signal,
          }).finally(() => clearTimeout(timeout));
          const data = await res.json().catch(() => null);

          // A AGENDA só conhece tenants com crm_barbershop_id gravado no banco
          // dela. Cliente criado/vinculado só na ATENDIMENTO (caminho grátis)
          // volta "not_linked" (404) aqui — antes isso virava erro na tela,
          // mesmo o cliente tendo conta de verdade na ATENDIMENTO. Agora, só
          // nesse caso exato, tenta a ponte da ATENDIMENTO (sem criar nada:
          // create_if_missing=false; se também não existir lá, devolve o mesmo
          // erro de antes).
          if (res.status === 404 && data?.error === "not_linked") {
            const atendimentoUrl = process.env.AI_ATENDIMENTO_BRIDGE_URL_SSO;
            if (atendimentoUrl) {
              try {
                const c2 = new AbortController();
                const t2 = setTimeout(() => c2.abort(), 20000);
                const res2 = await fetch(atendimentoUrl, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "x-shared-secret": bridgeSecret },
                  body: JSON.stringify({
                    barbershop_id: auth.token.barbershop_id,
                    create_if_missing: false,
                    status_only: false,
                  }),
                  signal: c2.signal,
                }).finally(() => clearTimeout(t2));
                const data2 = await res2.json().catch(() => null);
                if (res2.ok && data2?.found !== false && data2?.action_link) {
                  return jsonResponse(request, { ok: true, action_link: data2.action_link });
                }
              } catch {
                // Falha na ATENDIMENTO cai no erro original da AGENDA abaixo.
              }
            }
          }

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
