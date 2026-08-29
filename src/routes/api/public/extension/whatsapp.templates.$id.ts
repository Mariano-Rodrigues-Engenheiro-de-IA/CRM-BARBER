// PATCH /api/public/extension/whatsapp/templates/:id
//
// Edita um modelo já existente — reenvia pra análise da Meta (mesmo que já
// estivesse aprovado, volta pra "em análise"). Não dá pra editar nome nem
// transformar num carrossel por aqui — pra isso, cria um modelo novo.

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

export const Route = createFileRoute("/api/public/extension/whatsapp/templates/$id")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      PATCH: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        if (!isAdminBarbershop(auth.token.barbershop_id)) {
          return jsonResponse(request, { ok: false, error: "Recurso ainda não disponível." }, { status: 403 });
        }

        const instance = await loadInstance(supabaseAdmin, auth.token.barbershop_id);
        if (!instance || instance.provider !== "meta" || !instance.waba_id || !instance.meta_access_token) {
          return jsonResponse(request, { ok: false, error: "Conecte o WhatsApp pela API oficial antes de gerenciar modelos." }, { status: 400 });
        }

        const body = await request.json().catch(() => null);
        const category = typeof body?.category === "string" ? body.category.trim() : "";
        const bodyText = typeof body?.body_text === "string" ? body.body_text.trim() : "";
        const bodyExamples =
          body?.body_examples && typeof body.body_examples === "object" && !Array.isArray(body.body_examples)
            ? (Object.fromEntries(Object.entries(body.body_examples as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")])) as Record<
                string,
                string
              >)
            : undefined;
        const headerFormat = typeof body?.header_format === "string" ? body.header_format : null;
        const headerDataUrl = typeof body?.header_data_base64 === "string" ? body.header_data_base64 : null;
        const headerFilename = typeof body?.header_filename === "string" ? body.header_filename : "arquivo";
        const headerMime = typeof body?.header_mime === "string" ? body.header_mime : "";
        const footerText = typeof body?.footer_text === "string" ? body.footer_text.trim() : "";
        const buttonsRaw = Array.isArray(body?.buttons) ? (body.buttons as Array<Record<string, unknown>>) : [];

        if (!category || !bodyText) {
          return jsonResponse(request, { ok: false, error: "Campos obrigatórios: category, body_text" }, { status: 400 });
        }
        if (!["MARKETING", "UTILITY", "AUTHENTICATION"].includes(category)) {
          return jsonResponse(request, { ok: false, error: "category deve ser MARKETING, UTILITY ou AUTHENTICATION" }, { status: 400 });
        }
        if (buttonsRaw.length > 3) {
          return jsonResponse(request, { ok: false, error: "No máximo 3 botões por modelo." }, { status: 400 });
        }
        const buttons = buttonsRaw.map((b) => {
          if (b.type === "URL") return { type: "URL" as const, text: String(b.text ?? "").trim(), url: String(b.url ?? "").trim() };
          if (b.type === "PHONE_NUMBER")
            return { type: "PHONE_NUMBER" as const, text: String(b.text ?? "").trim(), phone_number: String(b.phone_number ?? "").trim() };
          return { type: "QUICK_REPLY" as const, text: String(b.text ?? "").trim() };
        });

        const { getWhatsAppProviderByName } = await import("@/lib/whatsapp/provider.server");
        const provider = getWhatsAppProviderByName("meta");
        if (!provider.editTemplate) {
          return jsonResponse(request, { ok: false, error: "Provider atual não suporta editar modelos." }, { status: 500 });
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

        const result = await provider.editTemplate({
          instance_token: instance.meta_access_token,
          template_id: params.id,
          category: category as "MARKETING" | "UTILITY" | "AUTHENTICATION",
          body_text: bodyText,
          body_examples: bodyExamples,
          header,
          footer_text: footerText || null,
          buttons: buttons.length > 0 ? buttons : null,
        });
        if (!result.ok) return jsonResponse(request, { ok: false, error: result.error }, { status: 502 });
        return jsonResponse(request, { ok: true });
      },
    },
  },
});
