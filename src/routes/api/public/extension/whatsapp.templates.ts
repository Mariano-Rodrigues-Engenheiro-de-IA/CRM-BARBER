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

        const footerText = typeof body?.footer_text === "string" ? body.footer_text.trim() : "";

        // Botões do modelo (não confundir com os botões de cada cartão do
        // carrossel, que vêm dentro de carousel_cards).
        const buttonsRaw = Array.isArray(body?.buttons) ? (body.buttons as Array<Record<string, unknown>>) : [];
        if (buttonsRaw.length > 3) {
          return jsonResponse(request, { ok: false, error: "No máximo 3 botões por modelo." }, { status: 400 });
        }
        for (const b of buttonsRaw) {
          if (!b.text || typeof b.text !== "string" || !b.text.trim()) {
            return jsonResponse(request, { ok: false, error: "Todo botão precisa de um texto." }, { status: 400 });
          }
          if (b.type === "URL" && (!b.url || typeof b.url !== "string" || !b.url.trim())) {
            return jsonResponse(request, { ok: false, error: "Todo botão de link precisa de uma URL." }, { status: 400 });
          }
          if (b.type === "PHONE_NUMBER" && (!b.phone_number || typeof b.phone_number !== "string" || !b.phone_number.trim())) {
            return jsonResponse(request, { ok: false, error: "Todo botão de telefone precisa de um número." }, { status: 400 });
          }
        }
        const buttons = buttonsRaw.map((b) => {
          if (b.type === "URL") return { type: "URL" as const, text: (b.text as string).trim(), url: (b.url as string).trim() };
          if (b.type === "PHONE_NUMBER")
            return { type: "PHONE_NUMBER" as const, text: (b.text as string).trim(), phone_number: (b.phone_number as string).trim() };
          return { type: "QUICK_REPLY" as const, text: (b.text as string).trim() };
        });

        // Carrossel — array de cartões, cada um com sua própria mídia
        // (data URL) e, opcionalmente, texto e botões.
        const carouselCardsRaw = Array.isArray(body?.carousel_cards) ? (body.carousel_cards as unknown[]) : null;

        if (carouselCardsRaw) {
          if (category !== "MARKETING") {
            return jsonResponse(request, { ok: false, error: "Carrossel só é suportado em modelos da categoria Marketing." }, { status: 400 });
          }
          if (carouselCardsRaw.length < 2 || carouselCardsRaw.length > 10) {
            return jsonResponse(request, { ok: false, error: "Um carrossel precisa ter entre 2 e 10 cartões." }, { status: 400 });
          }
          const formats = new Set(carouselCardsRaw.map((c) => (c as Record<string, unknown>)?.header_format));
          if (formats.size > 1) {
            return jsonResponse(
              request,
              { ok: false, error: "Todos os cartões do carrossel precisam usar o mesmo tipo de mídia (todos Imagem, ou todos Vídeo)." },
              { status: 400 },
            );
          }
          for (const c of carouselCardsRaw) {
            const card = c as Record<string, unknown>;
            if (!card.header_format || !card.header_data_base64) {
              return jsonResponse(request, { ok: false, error: "Todo cartão do carrossel precisa ter uma mídia de cabeçalho (imagem ou vídeo)." }, { status: 400 });
            }
          }
          // Regra da Meta: se um cartão tem texto, todos precisam ter (pra
          // manter a mesma altura visual entre os cartões).
          const withText = carouselCardsRaw.filter((c) => typeof (c as Record<string, unknown>).body_text === "string" && (c as Record<string, unknown>).body_text);
          if (withText.length > 0 && withText.length < carouselCardsRaw.length) {
            return jsonResponse(
              request,
              { ok: false, error: "Se um cartão do carrossel tem texto, todos os outros também precisam ter (ou nenhum ter)." },
              { status: 400 },
            );
          }
        }

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

        let carousel: { cards: Array<{ header: { format: "IMAGE" | "VIDEO"; handle: string }; body_text?: string; buttons?: Array<{ type: "URL" | "QUICK_REPLY"; text: string; url?: string }> }> } | undefined;
        if (carouselCardsRaw) {
          if (!provider.uploadTemplateMedia) {
            return jsonResponse(request, { ok: false, error: "Provider atual não suporta enviar mídia de modelo." }, { status: 500 });
          }
          const cards: NonNullable<typeof carousel>["cards"] = [];
          for (const c of carouselCardsRaw) {
            const card = c as Record<string, unknown>;
            const cardUpload = await provider.uploadTemplateMedia({
              data_base64: card.header_data_base64 as string,
              mime: (card.header_mime as string) || "",
              filename: (card.header_filename as string) || "cartao",
            });
            if (!cardUpload.ok) {
              return jsonResponse(request, { ok: false, error: `Falha ao enviar a mídia de um cartão do carrossel: ${cardUpload.error}` }, { status: 502 });
            }
            const buttons = Array.isArray(card.buttons)
              ? (card.buttons as Array<Record<string, unknown>>)
                  .filter((b) => typeof b.text === "string" && b.text.trim())
                  .map((b) => ({
                    type: (b.type === "URL" ? "URL" : "QUICK_REPLY") as "URL" | "QUICK_REPLY",
                    text: String(b.text).trim(),
                    url: typeof b.url === "string" ? b.url.trim() : undefined,
                  }))
              : undefined;
            cards.push({
              header: { format: card.header_format as "IMAGE" | "VIDEO", handle: cardUpload.handle },
              body_text: typeof card.body_text === "string" && card.body_text.trim() ? card.body_text.trim() : undefined,
              buttons: buttons && buttons.length > 0 ? buttons : undefined,
            });
          }
          carousel = { cards };
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
          footer_text: footerText || null,
          buttons: buttons.length > 0 ? buttons : null,
          carousel,
        });
        if (!result.ok) {
          return jsonResponse(request, { ok: false, error: result.error }, { status: 502 });
        }
        return jsonResponse(request, { ok: true, id: result.id });
      },
    },
  },
});
