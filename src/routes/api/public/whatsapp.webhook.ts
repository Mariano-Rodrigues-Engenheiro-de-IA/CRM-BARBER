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

function graphUrl(path: string): string {
  const version = process.env.META_GRAPH_VERSION ?? "v26.0";
  return `https://graph.facebook.com/${version}/${path}`;
}

/** Processa um evento account_update. O nome do evento que a Meta manda de
 * verdade quando alguém termina a Integração Zero (hosted embedded signup)
 * é PARTNER_APP_INSTALLED — não PARTNER_ADDED como a documentação mais
 * antiga sugeria (confirmado direto pelo payload real recebido). Aceita os
 * dois nomes por segurança, caso a Meta mude de novo ou varie por versão.
 * Esse evento só traz o waba_id, sem nenhum "state" dizendo de qual
 * barbearia é. Por enquanto (só o Mariano testando, ainda não liberado pra
 * clientes) associamos direto à conta admin — quando for liberar pra
 * clientes de verdade, isso precisa de uma forma de identificar a
 * barbearia certa (ex: um link por barbearia, ou confirmação manual). */
async function handleAccountUpdate(change: Json) {
  console.info("[whatsapp.webhook] account_update recebido:", JSON.stringify(change).slice(0, 2000));

  const value = change.value as Json | undefined;
  const event = typeof value?.event === "string" ? value.event : null;
  const wabaInfo = value?.waba_info as Json | undefined;
  const wabaId = typeof wabaInfo?.waba_id === "string" ? (wabaInfo.waba_id as string) : null;
  const ownerBusinessId = typeof wabaInfo?.owner_business_id === "string" ? (wabaInfo.owner_business_id as string) : null;

  if ((event !== "PARTNER_APP_INSTALLED" && event !== "PARTNER_ADDED") || !wabaId) return;

  const adminBarbershopId = process.env.ADMIN_BARBERSHOP_ID;
  const systemToken = process.env.META_SYSTEM_USER_TOKEN;
  if (!adminBarbershopId || !systemToken) {
    console.warn(
      `[whatsapp.webhook] ${event} recebido, mas ADMIN_BARBERSHOP_ID ou META_SYSTEM_USER_TOKEN não configurados — conexão não foi salva automaticamente.`,
    );
    return;
  }

  try {
    const phonesRes = await fetch(
      `${graphUrl(`${wabaId}/phone_numbers?fields=id,display_phone_number`)}&access_token=${encodeURIComponent(systemToken)}`,
    );
    const phonesJson = (await phonesRes.json()) as Json;
    if (!phonesRes.ok) {
      const errMsg = (phonesJson.error as Json | undefined)?.message;
      throw new Error(typeof errMsg === "string" ? errMsg : `HTTP ${phonesRes.status}`);
    }
    const first = (Array.isArray(phonesJson.data) ? (phonesJson.data[0] as Json | undefined) : undefined) ?? {};
    const phoneNumberId = typeof first.id === "string" ? first.id : null;
    const phone = typeof first.display_phone_number === "string" ? first.display_phone_number : null;
    if (!phoneNumberId) {
      console.warn(`[whatsapp.webhook] WABA ${wabaId} ainda sem número de telefone disponível.`);
      return;
    }

    // Assina o app nos webhooks dessa WABA — mesmo passo que o fluxo
    // customizado já faz depois de conectar.
    await fetch(graphUrl(`${wabaId}/subscribed_apps`), {
      method: "POST",
      headers: { Authorization: `Bearer ${systemToken}` },
    }).catch((e) => console.warn("[whatsapp.webhook] falha ao assinar webhooks da WABA:", e));

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const payload = {
      barbershop_id: adminBarbershopId,
      provider: "meta",
      instance_id: phoneNumberId,
      instance_token: systemToken,
      status: "connected",
      phone,
      waba_id: wabaId,
      phone_number_id: phoneNumberId,
      meta_access_token: systemToken,
      meta_business_id: ownerBusinessId,
      last_error: null,
      last_synced_at: new Date().toISOString(),
    };
    const { data: existing } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("id")
      .eq("barbershop_id", adminBarbershopId)
      .maybeSingle();
    const { error } = existing
      ? await supabaseAdmin.from("whatsapp_instances").update(payload).eq("id", existing.id)
      : await supabaseAdmin.from("whatsapp_instances").insert(payload);
    if (error) throw new Error(error.message);
    console.info(`[whatsapp.webhook] Conexão via Integração Zero salva: waba=${wabaId} phone=${phone}`);
  } catch (e) {
    console.error(`[whatsapp.webhook] falha ao processar ${event}:`, e instanceof Error ? e.message : e);
  }
}

async function handleMessagesChange(change: Json) {
  console.info("[whatsapp.webhook] messages recebido:", JSON.stringify(change).slice(0, 2000));
  // A ingestão de mensagens recebidas pela extensão/painel já acontece por
  // outro caminho hoje (sincronização via extensão do Chrome). Esse webhook
  // por ora só confirma recebimento pra Meta considerar a assinatura ativa.
}

async function logWebhookCall(kind: string, statusCode: number, headers: Record<string, string>, body: unknown, note?: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("webhook_logs").insert({
      source: "meta_whatsapp",
      method: kind === "verify" ? "GET" : "POST",
      kind,
      status_code: statusCode,
      headers,
      body: body as never,
      note: note ?? null,
    });
  } catch (e) {
    // Nunca deixa o log derrubar o webhook de verdade.
    console.error("[whatsapp.webhook] falha ao gravar log:", e);
  }
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
          await logWebhookCall("verify", 500, { mode: mode ?? "", token: token ?? "" }, null, "WHATSAPP_WEBHOOK_VERIFY_TOKEN não configurado no servidor");
          return new Response("Webhook não configurado", { status: 500 });
        }
        if (mode === "subscribe" && token === expectedToken && challenge) {
          await logWebhookCall("verify", 200, { mode, token: "(confere)" }, null, "Verificação OK");
          return new Response(challenge, { status: 200 });
        }
        await logWebhookCall(
          "verify",
          403,
          { mode: mode ?? "", token: token ?? "" },
          null,
          token && token !== expectedToken ? "Token de verificação não bate com WHATSAPP_WEBHOOK_VERIFY_TOKEN" : "Requisição de verificação incompleta/inesperada",
        );
        return new Response("Forbidden", { status: 403 });
      },

      // Eventos reais.
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const signature = request.headers.get("x-hub-signature-256");
        if (!verifySignature(rawBody, signature)) {
          console.warn("[whatsapp.webhook] Assinatura inválida — evento rejeitado.");
          await logWebhookCall("rejected", 401, { signature: signature ?? "(ausente)" }, safeParse(rawBody), "Assinatura X-Hub-Signature-256 inválida");
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: Json;
        try {
          payload = JSON.parse(rawBody) as Json;
        } catch {
          await logWebhookCall("rejected", 400, {}, rawBody.slice(0, 2000), "JSON inválido no corpo da requisição");
          return new Response("Invalid JSON", { status: 400 });
        }

        let note: string | undefined;
        try {
          const entries = Array.isArray(payload.entry) ? (payload.entry as Json[]) : [];
          const fields: string[] = [];
          for (const entry of entries) {
            const changes = Array.isArray(entry.changes) ? (entry.changes as Json[]) : [];
            for (const change of changes) {
              const field = change.field;
              fields.push(typeof field === "string" ? field : String(field));
              if (field === "account_update") {
                await handleAccountUpdate(change);
              } else if (field === "messages") {
                await handleMessagesChange(change);
              } else {
                console.info("[whatsapp.webhook] evento não tratado:", field);
              }
            }
          }
          note = fields.length ? `Campos: ${fields.join(", ")}` : "Sem entry/changes no payload";
        } catch (e) {
          // A Meta reenvia (com backoff) se não receber 200 — logamos o erro
          // mas confirmamos recebimento mesmo assim, pra não entrar num loop
          // de reenvio por causa de um evento que não sabemos processar.
          console.error("[whatsapp.webhook] erro ao processar payload:", e);
          note = `Erro ao processar: ${e instanceof Error ? e.message : String(e)}`;
        }

        await logWebhookCall("event", 200, {}, payload as unknown, note);

        // A Meta exige HTTP 200 rápido — processamento pesado deveria ser
        // assíncrono/enfileirado, mas por ora o processamento acima é leve
        // o bastante (só log) pra responder inline sem risco de timeout.
        return Response.json({ received: true });
      },
    },
  },
});

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw.slice(0, 2000);
  }
}
