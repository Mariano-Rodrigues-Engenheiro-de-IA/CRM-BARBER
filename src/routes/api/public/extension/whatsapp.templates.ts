// GET /api/public/extension/whatsapp/templates
// POST /api/public/extension/whatsapp/templates
//
// Lista e cria modelos de mensagem (templates) na WABA conectada — pra
// gerenciar tudo pelo painel, sem precisar entrar no Gerenciador do
// WhatsApp da própria Meta.
//
// Restrito ao administrador (ADMIN_BARBERSHOP_ID) por enquanto — ainda
// não é uma funcionalidade liberada pra clientes finais.

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { isAdminBarbershop } from "@/lib/admin-guard.server";

async function loadInstance(supabaseAdmin: any, barbershop_id: string) {
  const { data: instance } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("provider, waba_id, meta_access_token")
    .eq("barbershop_id", barbershop_id)
    .maybeSingle();
  return instance;
}

export const Route = createFileRoute("/api/public/extension/whatsapp/templates")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        if (!isAdminBarbershop(auth.token.barbershop_id)) {
          return jsonResponse(request, { ok: false, error: "Recurso ainda não disponível." }, { status: 403 });
        }

        const instance = await loadInstance(supabaseAdmin, auth.token.barbershop_id);
        if (!instance || instance.provider !== "meta" || !instance.waba_id) {
          return jsonResponse(
            request,
            { ok: false, error: "Conecte o WhatsApp pela API oficial antes de gerenciar modelos." },
            { status: 400 },
          );
        }
        if (!instance.meta_access_token) {
          return jsonResponse(request, { ok: false, error: "Token de acesso ausente na instância." }, { status: 400 });
        }

        const { getWhatsAppProviderByName } = await import("@/lib/whatsapp/provider.server");
        const provider = getWhatsAppProviderByName("meta");
        if (!provider.listTemplates) {
          return jsonResponse(request, { ok: false, error: "Provider atual não suporta listar modelos." }, { status: 500 });
        }

        const result = await provider.listTemplates({
          instance_token: instance.meta_access_token,
          waba_id: instance.waba_id,
        });
        if (!result.ok) {
          return jsonResponse(request, { ok: false, error: result.error }, { status: 502 });
        }
        return jsonResponse(request, { ok: true, templates: result.templates });
      },

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
        const name = typeof body?.name === "string" ? body.name.trim() : "";
        const category = typeof body?.category === "string" ? body.category.trim() : "";
        const languageCode = typeof body?.language_code === "string" ? body.language_code.trim() : "";
        const bodyText = typeof body?.body_text === "string" ? body.body_text.trim() : "";

        if (!name || !category || !languageCode || !bodyText) {
          return jsonResponse(
            request,
            { ok: false, error: "Campos obrigatórios: name, category, language_code, body_text" },
            { status: 400 },
          );
        }
        if (!["MARKETING", "UTILITY", "AUTHENTICATION"].includes(category)) {
          return jsonResponse(
            request,
            { ok: false, error: "category deve ser MARKETING, UTILITY ou AUTHENTICATION" },
            { status: 400 },
          );
        }
        // Nome de template só aceita minúsculas, números e underscore —
        // regra da própria Meta. Falha silenciosa vira erro confuso lá na
        // frente, então valida aqui antes de gastar uma chamada de API.
        if (!/^[a-z0-9_]+$/.test(name)) {
          return jsonResponse(
            request,
            { ok: false, error: "Nome do modelo só pode ter letras minúsculas, números e _ (sem espaços/acentos)." },
            { status: 400 },
          );
        }

        const instance = await loadInstance(supabaseAdmin, auth.token.barbershop_id);
        if (!instance || instance.provider !== "meta" || !instance.waba_id) {
          return jsonResponse(
            request,
            { ok: false, error: "Conecte o WhatsApp pela API oficial antes de gerenciar modelos." },
            { status: 400 },
          );
        }
        if (!instance.meta_access_token) {
          return jsonResponse(request, { ok: false, error: "Token de acesso ausente na instância." }, { status: 400 });
        }

        const { getWhatsAppProviderByName } = await import("@/lib/whatsapp/provider.server");
        const provider = getWhatsAppProviderByName("meta");
        if (!provider.createTemplate) {
          return jsonResponse(request, { ok: false, error: "Provider atual não suporta criar modelos." }, { status: 500 });
        }

        const result = await provider.createTemplate({
          instance_token: instance.meta_access_token,
          waba_id: instance.waba_id,
          name,
          category: category as "MARKETING" | "UTILITY" | "AUTHENTICATION",
          language_code: languageCode,
          body_text: bodyText,
        });
        if (!result.ok) {
          return jsonResponse(request, { ok: false, error: result.error }, { status: 502 });
        }
        return jsonResponse(request, { ok: true, id: result.id });
      },
    },
  },
});
