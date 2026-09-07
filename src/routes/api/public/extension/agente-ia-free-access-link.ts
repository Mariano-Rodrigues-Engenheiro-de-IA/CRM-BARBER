// GET /api/public/extension/agente-ia-free-access-link -> gera um link
// mágico de acesso ao IA-BARBER-ATENDIMENTO (caminho "Configurar
// grátis"). Diferente de agente-ia-access-link.ts (que é a ponte paga,
// pra IA-BARBER-AGENDA, e só funciona se já existir tenant vinculado),
// essa aqui AUTO-CRIA o tenant na primeira vez que a barbearia/clínica
// escolhe configurar sozinha — por isso manda nome e e-mail junto.

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

export const Route = createFileRoute("/api/public/extension/agente-ia-free-access-link")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }

        // ?create=1 só é enviado quando o cliente clica de verdade em
        // "Configurar grátis" — sem isso, é só checagem de status (ex:
        // página carregando), que nunca deve criar tenant sozinha.
        //
        // ?status=1 sinaliza que essa chamada é SÓ pra decidir qual tela
        // mostrar, NUNCA deve gerar link de verdade — sem isso, cada
        // checagem de status (ex: página carregando de novo) gerava um
        // magic link de verdade em segundo plano, e como o Supabase
        // invalida o link anterior toda vez que um novo é emitido, o
        // link que o cliente tinha acabado de copiar/clicar podia já
        // estar morto.
        const url = new URL(request.url);
        const createIfMissing = url.searchParams.get("create") === "1";
        const statusOnly = url.searchParams.get("status") === "1";

        const bridgeSecret = process.env.CRM_BRIDGE_SHARED_SECRET;
        const bridgeUrl = process.env.AI_ATENDIMENTO_BRIDGE_URL_SSO; // ex: https://<projeto-atendimento>.supabase.co/functions/v1/crm-bridge-access-link
        if (!bridgeSecret || !bridgeUrl) {
          return jsonResponse(request, { ok: false, error: "Ponte com a IA (gratuita) não configurada." }, { status: 500 });
        }

        const { data: shop } = await supabaseAdmin
          .from("barbershops")
          .select("name, owner_email")
          .eq("id", auth.token.barbershop_id)
          .maybeSingle();
        if (createIfMissing && !shop?.owner_email) {
          return jsonResponse(
            request,
            { ok: false, error: "Cadastre um e-mail em Configurações antes de configurar a IA gratuitamente." },
            { status: 422 },
          );
        }

        try {
          const controller = new AbortController();
          // Criar tenant novo faz várias chamadas em sequência (usuário,
          // tenant, vínculo, link) — 8s era curto demais pra isso,
          // principalmente com a função "fria". Checagem de status
          // continua rápida, mantém o timeout curto.
          const timeoutMs = createIfMissing ? 20000 : 8000;
          const timeout = setTimeout(() => controller.abort(), timeoutMs);
          const res = await fetch(bridgeUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-shared-secret": bridgeSecret },
            body: JSON.stringify({
              barbershop_id: auth.token.barbershop_id,
              name: shop?.name,
              email: shop?.owner_email,
              create_if_missing: createIfMissing,
              status_only: statusOnly,
            }),
            signal: controller.signal,
          }).finally(() => clearTimeout(timeout));
          const data = await res.json().catch(() => null);
          if (!res.ok) {
            return jsonResponse(
              request,
              { ok: false, error: data?.message || data?.error || "Não foi possível gerar o acesso agora." },
              { status: 502 },
            );
          }
          if (data?.found === false) {
            return jsonResponse(request, { ok: true, found: false });
          }
          if (statusOnly) {
            // Resposta de checagem de status não vem com action_link de
            // propósito (a ponte nunca gera link nesse modo).
            return jsonResponse(request, { ok: true, found: true, onboarding_completed: !!data?.onboarding_completed });
          }
          if (!data?.action_link) {
            return jsonResponse(request, { ok: false, error: "Resposta inesperada da ponte." }, { status: 502 });
          }
          return jsonResponse(request, {
            ok: true,
            found: true,
            action_link: data.action_link,
            onboarding_completed: !!data.onboarding_completed,
          });
        } catch (e) {
          return jsonResponse(request, { ok: false, error: "Tempo esgotado ao gerar o acesso." }, { status: 504 });
        }
      },
    },
  },
});
