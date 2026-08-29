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
        const bodyExamples =
          body?.body_examples && typeof body.body_examples === "object" && !Array.isArray(body.body_examples)
            ? (Object.fromEntries(
                Object.entries(body.body_examples as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")]),
              ) as Record<string, string>)
            : undefined;
        // Cabeçalho de mídia opcional — o cliente já manda o arquivo como
        // data URL (base64) pronto, igual ao padrão já usado em outros
        // uploads do sistema (respostas rápidas, anotações etc.).
        const headerFormat = typeof body?.header_format === "string" ? body.header_format : null;
        const headerDataUrl = typeof body?.header_data_base64 === "string" ? body.header_data_base64 : null;
        const headerFilename = typeof body?.header_filename === "string" ? body.header_filename : "arquivo";
        const headerMime = typeof body?.header_mime === "string" ? body.header_mime : "";

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
        if (headerFormat && !["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat)) {
          return jsonResponse(request, { ok: false, error: "header_format deve ser IMAGE, VIDEO ou DOCUMENT" }, { status: 400 });
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
        // Mesma regra da Meta pra variáveis nomeadas ({{nome}}, {{data}}):
        // minúsculas e _ só, sem espaço/acento — senão a criação falha lá
        // na hora, sem essa validação prévia mais clara.
        let invalidVar: string | null = null;
        {
          const re = /\{\{([^}]+)\}\}/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(bodyText))) {
            if (!/^[a-z0-9_]+$/.test(m[1])) {
              invalidVar = m[1];
              break;
            }
          }
        }
        if (invalidVar) {
          return jsonResponse(
            request,
            {
              ok: false,
              error: `Variável "{{${invalidVar}}}" inválida — use só letras minúsculas, números e _ (ex: {{nome}}, {{data_agendamento}}).`,
            },
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

        let header: { format: "IMAGE" | "VIDEO" | "DOCUMENT"; handle: string } | undefined;
        if (headerFormat && headerDataUrl) {
          if (!provider.uploadTemplateMedia) {
            return jsonResponse(request, { ok: false, error: "Provider atual não suporta enviar mídia de modelo." }, { status: 500 });
          }
          const uploadResult = await provider.uploadTemplateMedia({
            data_base64: headerDataUrl,
            mime: headerMime,
            filename: headerFilename,
          });
          if (!uploadResult.ok) {
            return jsonResponse(request, { ok: false, error: `Falha ao enviar a mídia do cabeçalho: ${uploadResult.error}` }, { status: 502 });
          }
          header = { format: headerFormat as "IMAGE" | "VIDEO" | "DOCUMENT", handle: uploadResult.handle };
        }

        const result = await provider.createTemplate({
          instance_token: instance.meta_access_token,
          waba_id: instance.waba_id,
          name,
          category: category as "MARKETING" | "UTILITY" | "AUTHENTICATION",
          language_code: languageCode,
          body_text: bodyText,
          body_examples: bodyExamples,
          header,
        });
        if (!result.ok) {
          return jsonResponse(request, { ok: false, error: result.error }, { status: 502 });
        }
        return jsonResponse(request, { ok: true, id: result.id });
      },
    },
  },
});
