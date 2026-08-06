// Webhook do WhatsApp/Meta — recebe eventos da Cloud API oficial.
// Caminho: /api/public/whatsapp/webhook
//
// A Meta usa o MESMO endpoint pra duas coisas:
//  - GET: verificação inicial (a Meta manda um "desafio" pra confirmar que
//    essa URL é sua de verdade, antes de aceitar salvar a configuração).
//  - POST: os eventos reais (mensagens recebidas, status de entrega,
//    account_update — este último é pré-requisito documentado do Cadastro
//    Incorporado: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation).
//
// Requer WHATSAPP_WEBHOOK_VERIFY_TOKEN (escolhido por nós, colado na tela
// de configuração de webhook da Meta) e, opcionalmente, META_APP_SECRET
// (recomendado, pra verificar a assinatura HMAC dos eventos recebidos).

import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

/** Verifica a assinatura X-Hub-Signature-256 usando META_APP_SECRET, se
 * configurado. Sem o secret, aceita o evento mesmo assim (log de aviso) —
 * melhor processar sem verificação do que travar o webhook inteiro por
 * falta dessa variável opcional. */
function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    console.warn("[whatsapp.webhook] META_APP_SECRET não configurado — pulando verificação de assinatura.");
    return true;
  }
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const received = signatureHeader.slice("sha256=".length);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

type Json = Record<string, unknown>;

/** Processa um evento account_update — o único tipo que o Cadastro
 * Incorporado exige assinatura, por enquanto só loga; pode ser expandido
 * pra sincronizar status de conta automaticamente no futuro. */
async function handleAccountUpdate(change: Json) {
  console.info("[whatsapp.webhook] account_update recebido:", JSON.stringify(change).slice(0, 2000));
}

async function handleMessagesChange(change: Json) {
  console.info("[whatsapp.webhook] messages recebido:", JSON.stringify(change).slice(0, 2000));
  // A ingestão de mensagens recebidas pela extensão/painel já acontece por
  // outro caminho hoje (sincronização via extensão do Chrome). Esse webhook
  // por ora só confirma recebimento pra Meta considerar a assinatura ativa.
}

export const Route = createFileRoute("/api/public/whatsapp/webhook")({
  server: {
    handlers: {
      // Verificação inicial exigida pela Meta ao salvar a URL do webhook.
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");

        const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
        if (!expectedToken) {
          console.error("[whatsapp.webhook] WHATSAPP_WEBHOOK_VERIFY_TOKEN não configurado.");
          return new Response("Webhook não configurado", { status: 500 });
        }
        if (mode === "subscribe" && token === expectedToken && challenge) {
          return new Response(challenge, { status: 200 });
        }
        return new Response("Forbidden", { status: 403 });
      },

      // Eventos reais.
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const signature = request.headers.get("x-hub-signature-256");
        if (!verifySignature(rawBody, signature)) {
          console.warn("[whatsapp.webhook] Assinatura inválida — evento rejeitado.");
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: Json;
        try {
          payload = JSON.parse(rawBody) as Json;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        try {
          const entries = Array.isArray(payload.entry) ? (payload.entry as Json[]) : [];
          for (const entry of entries) {
            const changes = Array.isArray(entry.changes) ? (entry.changes as Json[]) : [];
            for (const change of changes) {
              const field = change.field;
              if (field === "account_update") {
                await handleAccountUpdate(change);
              } else if (field === "messages") {
                await handleMessagesChange(change);
              } else {
                console.info("[whatsapp.webhook] evento não tratado:", field);
              }
            }
          }
        } catch (e) {
          // A Meta reenvia (com backoff) se não receber 200 — logamos o erro
          // mas confirmamos recebimento mesmo assim, pra não entrar num loop
          // de reenvio por causa de um evento que não sabemos processar.
          console.error("[whatsapp.webhook] erro ao processar payload:", e);
        }

        // A Meta exige HTTP 200 rápido — processamento pesado deveria ser
        // assíncrono/enfileirado, mas por ora o processamento acima é leve
        // o bastante (só log) pra responder inline sem risco de timeout.
        return Response.json({ received: true });
      },
    },
  },
});
