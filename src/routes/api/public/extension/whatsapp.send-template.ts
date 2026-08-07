// POST /api/public/extension/whatsapp/send-template
//
// Endpoint de teste manual pra envio de modelo de mensagem (message
// template) já aprovado no Gerenciador do WhatsApp — só funciona com a
// API oficial (provider "meta"), já que templates não existem no UAZAPI.
//
// Corpo esperado:
// { "to": "5511999999999", "template_name": "hello_world",
//   "language_code": "en_US", "body_params": ["Nome", "Valor"] }

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { isAdminBarbershop } from "@/lib/admin-guard.server";

export const Route = createFileRoute("/api/public/extension/whatsapp/send-template")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        if (!isAdminBarbershop(auth.token.barbershop_id)) {
          return jsonResponse(request, { ok: false, error: "Recurso ainda não disponível." }, { status: 403 });
        }

        const body = await request.json().catch(() => null);
        const to = typeof body?.to === "string" ? body.to.trim() : "";
        const templateName = typeof body?.template_name === "string" ? body.template_name.trim() : "";
        const languageCode = typeof body?.language_code === "string" ? body.language_code.trim() : "";
        const bodyParams = Array.isArray(body?.body_params)
          ? body.body_params.filter((p: unknown) => typeof p === "string")
          : undefined;

        if (!to || !templateName || !languageCode) {
          return jsonResponse(
            request,
            { ok: false, error: "Campos obrigatórios: to, template_name, language_code" },
            { status: 400 },
          );
        }

        const { data: instance } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("provider, phone_number_id, meta_access_token")
          .eq("barbershop_id", auth.token.barbershop_id)
          .maybeSingle();

        if (!instance || instance.provider !== "meta") {
          return jsonResponse(
            request,
            { ok: false, error: "Envio de modelo só disponível com a API oficial (Cadastro Incorporado) conectada." },
            { status: 400 },
          );
        }
        if (!instance.meta_access_token) {
          return jsonResponse(request, { ok: false, error: "Token de acesso ausente na instância." }, { status: 400 });
        }

        const { getWhatsAppProviderByName } = await import("@/lib/whatsapp/provider.server");
        const provider = getWhatsAppProviderByName("meta");
        if (!provider.sendTemplate) {
          return jsonResponse(request, { ok: false, error: "Provider atual não suporta envio de modelo." }, { status: 500 });
        }

        const result = await provider.sendTemplate({
          instance_token: instance.meta_access_token,
          phone_number_id: instance.phone_number_id,
          to,
          template_name: templateName,
          language_code: languageCode,
          body_params: bodyParams,
        });

        if (!result.ok) {
          return jsonResponse(request, { ok: false, error: result.error }, { status: 502 });
        }
        return jsonResponse(request, { ok: true, provider_message_id: result.provider_message_id });
      },
    },
  },
});
