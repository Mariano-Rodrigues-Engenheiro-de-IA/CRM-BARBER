// POST /api/public/extension/campaigns/saved/:id/submit -> envia uma
// campanha salva (status 'draft') pra aprovação da Meta de verdade,
// reaproveitando o mesmo mecanismo de criação de modelo já usado em
// whatsapp.templates.ts. Só faz sentido pra quem está na API oficial.

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

// Meta exige valor de exemplo pra CADA variável nomeada ({{nome}}), ou
// a criação do modelo falha. Exemplos plausíveis pras variáveis já
// usadas nas mensagens do sistema — genérico como reserva pra
// qualquer outra.
const VAR_EXAMPLES: Record<string, string> = {
  nome: "João",
  valor: "R$ 79,90",
  vencimento: "20/11/2026",
  data: "20/11/2026",
};

/** Converte {variavel} (formato usado no resto do sistema) pro formato
 * {{variavel}} que a API de modelos da Meta exige, e monta o mapa de
 * exemplos correspondente. */
function convertToMetaFormat(text: string): { body: string; examples: Record<string, string> } {
  const examples: Record<string, string> = {};
  const body = text.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_match, varName: string) => {
    const key = varName.toLowerCase();
    examples[key] = VAR_EXAMPLES[key] ?? "exemplo";
    return `{{${key}}}`;
  });
  return { body, examples };
}

/** Nome de modelo: só minúsculas, números e _ (regra da Meta). Gerado a
 * partir do título + um sufixo curto de tempo, pra não colidir se a
 * mesma campanha for reenviada depois de rejeitada. */
function slugifyTemplateName(title: string): string {
  const base = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `${base || "campanha"}_${Date.now().toString(36)}`;
}

export const Route = createFileRoute("/api/public/extension/campaigns/saved/$id/submit")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      POST: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }

        // audio_path não entra aqui de propósito: a Meta não aceita áudio
        // como cabeçalho de modelo (só IMAGE, VIDEO, DOCUMENT) — é uma
        // limitação real da própria API oficial, não uma omissão. O
        // áudio de uma campanha só é usado no disparo pela API
        // não-oficial (fora de modelo).
        const { data: campaign, error: campaignErr } = await supabaseAdmin
          .from("saved_campaigns")
          .select("id, title, body_text, image_path, status")
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id)
          .maybeSingle();
        if (campaignErr) {
          return jsonResponse(request, { ok: false, error: campaignErr.message }, { status: 500 });
        }
        if (!campaign) {
          return jsonResponse(
            request,
            { ok: false, error: "Campanha não encontrada." },
            { status: 404 },
          );
        }
        if (campaign.status !== "draft" && campaign.status !== "rejected") {
          return jsonResponse(
            request,
            { ok: false, error: "Essa campanha já foi enviada pra aprovação ou já está pronta." },
            { status: 400 },
          );
        }

        const { data: instance, error: instanceErr } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("provider, status, waba_id, meta_access_token")
          .eq("barbershop_id", auth.token.barbershop_id)
          .maybeSingle();
        if (instanceErr) {
          return jsonResponse(request, { ok: false, error: instanceErr.message }, { status: 500 });
        }
        if (
          !instance ||
          instance.provider !== "meta" ||
          instance.status !== "connected" ||
          !instance.waba_id ||
          !instance.meta_access_token
        ) {
          return jsonResponse(
            request,
            {
              ok: false,
              error: "Conecte o WhatsApp pela API oficial antes de enviar campanhas pra aprovação.",
            },
            { status: 400 },
          );
        }

        const { getWhatsAppProviderByName } = await import("@/lib/whatsapp/provider.server");
        const provider = getWhatsAppProviderByName("meta");
        if (!provider.createTemplate) {
          return jsonResponse(
            request,
            { ok: false, error: "Provider atual não suporta criar modelos." },
            { status: 500 },
          );
        }

        const { body: metaBodyText, examples } = convertToMetaFormat(campaign.body_text);
        const templateName = slugifyTemplateName(campaign.title);

        let header: { format: "IMAGE"; handle: string } | undefined;
        if (campaign.image_path) {
          if (!provider.uploadTemplateMedia) {
            return jsonResponse(
              request,
              { ok: false, error: "Provider atual não suporta enviar mídia de modelo." },
              { status: 500 },
            );
          }
          // image_path é uma URL pública do Storage (upload feito na
          // adoção da campanha) — baixa e converte pra base64 pra poder
          // subir como mídia de modelo na Meta.
          const imgRes = await fetch(campaign.image_path);
          if (!imgRes.ok) {
            return jsonResponse(
              request,
              { ok: false, error: "Não consegui baixar a imagem da campanha pra enviar." },
              { status: 502 },
            );
          }
          const arrayBuffer = await imgRes.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString("base64");
          const mime = imgRes.headers.get("content-type") || "image/jpeg";
          const uploadResult = await provider.uploadTemplateMedia({
            data_base64: base64,
            mime,
            filename: "capa.jpg",
          });
          if (!uploadResult.ok) {
            return jsonResponse(
              request,
              { ok: false, error: `Falha ao enviar a imagem: ${uploadResult.error}` },
              { status: 502 },
            );
          }
          header = { format: "IMAGE", handle: uploadResult.handle };
        }

        const result = await provider.createTemplate({
          instance_token: instance.meta_access_token,
          waba_id: instance.waba_id,
          name: templateName,
          category: "MARKETING",
          language_code: "pt_BR",
          body_text: metaBodyText,
          body_examples: Object.keys(examples).length > 0 ? examples : undefined,
          header,
        });
        if (!result.ok) {
          return jsonResponse(request, { ok: false, error: result.error }, { status: 502 });
        }

        const { data: updated, error: updateErr } = await supabaseAdmin
          .from("saved_campaigns")
          .update({
            status: "pending_approval",
            whatsapp_template_name: templateName,
            rejection_reason: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", campaign.id)
          .select(
            "id, catalog_campaign_id, title, body_text, image_path, status, rejection_reason, whatsapp_template_name, created_at",
          )
          .single();
        if (updateErr) {
          return jsonResponse(request, { ok: false, error: updateErr.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, campaign: updated });
      },
    },
  },
});
