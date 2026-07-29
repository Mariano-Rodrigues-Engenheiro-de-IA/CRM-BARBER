// GET /api/public/whatsapp/signup-callback
//
// Callback do Embedded Signup da API oficial (redirect do navegador vindo do
// hub do BSP). Não há token da extensão aqui: a identidade da barbearia vem
// do `state` assinado (HMAC + TTL). Sem state válido, rejeita — nunca
// aceita `barbershop_id` cru da URL.
//
// Ao final grava as credenciais em `whatsapp_instances` e devolve uma página
// simples que fecha o pop-up.

import { createFileRoute } from "@tanstack/react-router";

function page(title: string, message: string, ok: boolean, status = 200) {
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#fafafa;display:grid;place-items:center;height:100vh;margin:0}
main{max-width:26rem;text-align:center;padding:2rem}h1{font-size:1.15rem;margin:0 0 .5rem}
p{color:#a3a3a3;font-size:.9rem;line-height:1.5}</style></head>
<body><main><h1>${ok ? "✓ " : ""}${title}</h1><p>${message}</p></main>
<script>try{window.opener&&window.opener.postMessage({type:"whatsapp-signup",ok:${ok}},"*");setTimeout(function(){window.close()},${ok ? 1200 : 4000})}catch(e){}</script>
</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export const Route = createFileRoute("/api/public/whatsapp/signup-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const { verifySignupState } = await import("@/lib/whatsapp/signup-state.server");
        const verified = verifySignupState(url.searchParams.get("state"));
        if (!verified) {
          return page("Link inválido ou expirado", "Volte ao painel e clique em Conectar novamente.", false, 400);
        }

        // Usuário cancelou ou negou permissões no pop-up da Meta.
        const oauthError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
        if (oauthError) {
          return page("Vínculo cancelado", oauthError, false, 400);
        }

        // No 360dialog o identificador do cliente vem em `client`.
        const code = url.searchParams.get("client") ?? url.searchParams.get("code");
        if (!code) {
          return page("Vínculo não concluído", "O provedor não devolveu o identificador da conta.", false, 400);
        }

        const extra: Record<string, string> = {};
        for (const [k, v] of url.searchParams.entries()) {
          if (k !== "state" && k !== "client" && k !== "code") extra[k] = v;
        }

        try {
          // O Cadastro Incorporado só existe na API oficial — não depende da
          // env global `WHATSAPP_PROVIDER` (que pode estar em uazapi).
          const { getWhatsAppProviderByName } = await import("@/lib/whatsapp/provider.server");
          const provider = getWhatsAppProviderByName("meta");
          if (!provider.handleSignupCallback) {
            return page("Provedor sem signup", "O provedor ativo não usa o login da Meta.", false, 400);
          }


          const result = await provider.handleSignupCallback({
            code,
            barbershop_id: verified.barbershop_id,
            state: url.searchParams.get("state"),
            extra,
          });

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const payload = {
            barbershop_id: verified.barbershop_id,
            provider: provider.name,
            instance_id: result.phone_number_id,
            instance_token: result.access_token,
            status: result.status,
            phone: result.phone ?? null,
            last_qr: null,
            waba_id: result.waba_id,
            phone_number_id: result.phone_number_id,
            meta_access_token: result.access_token,
            meta_business_id: result.business_id ?? null,
            is_coexistence: result.is_coexistence,
            last_synced_at: new Date().toISOString(),
          };

          const { data: existing } = await supabaseAdmin
            .from("whatsapp_instances")
            .select("id")
            .eq("barbershop_id", verified.barbershop_id)
            .maybeSingle();

          if (existing) {
            await supabaseAdmin.from("whatsapp_instances").update(payload).eq("id", existing.id);
          } else {
            await supabaseAdmin.from("whatsapp_instances").insert(payload);
          }

          return page(
            "WhatsApp vinculado",
            result.is_coexistence
              ? "Número vinculado em modo Coexistência — você continua usando o app normalmente."
              : "Número vinculado à API oficial. Pode fechar esta janela.",
            true,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[whatsapp/signup-callback]", msg);
          return page("Falha ao vincular", msg, false, 502);
        }
      },
    },
  },
});
