// POST /api/public/extension/whatsapp/connect
//
// Cria (ou reaproveita) a instância WhatsApp da barbearia e devolve o
// QR code inicial. Após isso, o painel faz polling em /status pra pegar
// atualizações até `connected`.

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

export const Route = createFileRoute("/api/public/extension/whatsapp/connect")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const body = await request.json().catch(() => ({}) as any);
        const phoneHint = typeof body?.phone_hint === "string" ? body.phone_hint : null;

        const { data: existing } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("id, instance_id, instance_token, provider, phone_number_id, meta_access_token")
          .eq("barbershop_id", auth.token.barbershop_id)
          .maybeSingle();

        try {
          const { getWhatsAppProviderByName } = await import("@/lib/whatsapp/provider.server");
          const provider = existing?.provider === "meta"
            ? getWhatsAppProviderByName("meta")
            : getWhatsAppProviderByName("uazapi");
          const existingInstanceId = provider.name === "meta"
            ? existing?.phone_number_id ?? existing?.instance_id ?? null
            : existing?.instance_id ?? null;
          const existingInstanceToken = provider.name === "meta"
            ? existing?.meta_access_token ?? existing?.instance_token ?? null
            : existing?.instance_token ?? null;

          // Sem token salvo a API oficial NÃO é bloqueada: é justamente o
          // caso do primeiro Cadastro Incorporado (o token nasce no callback).



          const result = await provider.connect({
            barbershop_id: auth.token.barbershop_id,
            existing_instance_id: existingInstanceId,
            existing_instance_token: existingInstanceToken,
            phone_hint: phoneHint,
          });

          // No Embedded Signup as credenciais só nascem no callback: strings
          // vazias significam "mantém o que já está salvo".
          const payload = {
            barbershop_id: auth.token.barbershop_id,
            provider: provider.name,
            ...(result.instance_id ? { instance_id: result.instance_id } : {}),
            ...(result.instance_token ? { instance_token: result.instance_token } : {}),
            ...(provider.name === "meta" && result.instance_id ? { phone_number_id: result.instance_id } : {}),
            ...(provider.name === "meta" && result.instance_token ? { meta_access_token: result.instance_token } : {}),
            status: result.status,
            last_qr: result.qrcode ?? null,
            last_synced_at: new Date().toISOString(),
          };

          if (existing) {
            await supabaseAdmin
              .from("whatsapp_instances")
              .update(payload)
              .eq("id", existing.id);
          } else {
            await supabaseAdmin.from("whatsapp_instances").insert(payload);
          }

          return jsonResponse(request, {
            ok: true,
            connection: {
              status: result.status,
              qrcode: result.qrcode ?? null,
              phone: null,
              provider: provider.name,
              auth_mode: provider.authMode,
              signup: result.signup ?? null,
            },
          });

        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[whatsapp/connect]", msg);
          // Cadastro Incorporado sem credenciais de app configuradas: cai no
          // modo manual em vez de estourar erro genérico.
          if (existing?.provider === "meta" && /Cadastro Incorporado indispon/i.test(msg)) {
            return jsonResponse(request, {
              ok: true,
              connection: {
                status: "disconnected",
                qrcode: null,
                phone: null,
                provider: "meta",
                auth_mode: "embedded_signup",
                needs_manual_credentials: true,
                message: msg,
              },
            });
          }
          return jsonResponse(request, { ok: false, error: msg }, { status: 502 });
        }

      },
    },
  },
});
