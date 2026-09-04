// POST /api/public/whatsapp-uazapi-webhook/:token
//
// Webhook de mensagem RECEBIDA da uazapi (API não oficial) — equivalente
// ao whatsapp.webhook.ts (Meta), mas pro provedor não oficial. Existe só
// pra detectar quando o cliente responde "sim"/"confirmo" etc a uma
// mensagem de confirmação enviada por texto livre (a uazapi não tem
// botão de modelo aprovado como a Meta).
//
// Identificação da clínica: em vez de tentar adivinhar como a uazapi
// identifica a instância dentro do corpo da mensagem (formato não
// documentado publicamente de forma acessível — não tive como confirmar
// o payload exato), o token da instância vai NA PRÓPRIA URL do webhook,
// que a gente controla ao configurar. Isso funciona não importa qual
// seja o formato exato do corpo enviado pela uazapi.
//
// IMPORTANTE — pendente de confirmação com uso real: não consegui
// confirmar com certeza (1) o endpoint exato pra REGISTRAR esse webhook
// do lado da uazapi, nem (2) os nomes de campo exatos que ela usa pro
// texto/telefone no corpo da notificação. O parsing abaixo tenta várias
// variações comuns (text/message/body, phone/from/sender) e loga o
// corpo bruto recebido, pra confirmar rápido com um teste real e ajustar
// se precisar.

import { createFileRoute } from "@tanstack/react-router";

function extractText(payload: any): string | null {
  const candidates = [
    payload?.message?.text,
    payload?.message?.body,
    payload?.text,
    payload?.body,
    payload?.data?.message?.text,
    payload?.data?.text,
  ];
  const found = candidates.find((v) => typeof v === "string" && v.trim().length > 0);
  return found ? String(found).trim() : null;
}

function extractPhone(payload: any): string | null {
  const candidates = [
    payload?.message?.sender,
    payload?.message?.from,
    payload?.sender,
    payload?.from,
    payload?.phone,
    payload?.data?.sender,
    payload?.data?.from,
  ];
  const found = candidates.find((v) => typeof v === "string" && v.trim().length > 0);
  if (!found) return null;
  // Alguns formatos vêm como "5511999999999@s.whatsapp.net" — corta o
  // sufixo, fica só os dígitos.
  return String(found).split("@")[0].replace(/\D/g, "");
}

// Algumas plataformas marcam mensagem enviada PELA PRÓPRIA instância
// (eco do envio) com esse tipo de campo — sem essa checagem, o sistema
// podia "responder a si mesmo" e confirmar sozinho por engano.
function isFromMe(payload: any): boolean {
  return !!(payload?.message?.fromMe ?? payload?.fromMe ?? payload?.data?.fromMe);
}

export const Route = createFileRoute("/api/public/whatsapp-uazapi-webhook/$token")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const token = params.token;
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        console.info("[whatsapp-uazapi-webhook] payload bruto recebido:", JSON.stringify(payload).slice(0, 1000));

        if (isFromMe(payload)) {
          return new Response(JSON.stringify({ ok: true, skipped: "from_me" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        const text = extractText(payload);
        const phone = extractPhone(payload);
        if (!text || !phone) {
          console.info("[whatsapp-uazapi-webhook] não achei texto/telefone no formato esperado. Ajustar extractText/extractPhone.");
          return new Response(JSON.stringify({ ok: true, skipped: "no_text_or_phone" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: instance } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("barbershop_id")
          .eq("instance_token", token)
          .maybeSingle();
        if (!instance?.barbershop_id) {
          return new Response(JSON.stringify({ ok: false, error: "Instância não encontrada" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { handleConfirmationTextReplyForBarbershop } = await import("@/lib/agenda-reminders.server");
        await handleConfirmationTextReplyForBarbershop(instance.barbershop_id, phone, text);

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
