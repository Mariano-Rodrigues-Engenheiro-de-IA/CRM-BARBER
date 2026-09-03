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

/** Processa um evento account_update. Cobre dois casos:
 *  - PARTNER_APP_INSTALLED (nome real que a Meta manda pra "conectou";
 *    a doc mais antiga sugeria PARTNER_ADDED, aceita os dois por
 *    segurança) — conexão nova via Integração Zero. Esse evento só traz
 *    o waba_id, sem nenhum "state" dizendo de qual barbearia é, então
 *    fica pendente pra um admin reivindicar em /admin (WhatsApp/Meta).
 *  - PARTNER_REMOVED — o cliente desconectou pelo próprio celular
 *    (Configurações > Conta > Plataforma do WhatsApp Business > opção
 *    de desconectar). Sem tratar isso, o CRM continuava mostrando
 *    "conectado" pra sempre, mesmo com a Meta já tendo cortado o
 *    vínculo do lado dela. https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/ */
async function handleAccountUpdate(change: Json, entryWabaId: string | null) {
  console.info("[whatsapp.webhook] account_update recebido:", JSON.stringify(change).slice(0, 2000));

  const value = change.value as Json | undefined;
  const event = typeof value?.event === "string" ? value.event : null;
  const wabaInfo = value?.waba_info as Json | undefined;
  // PARTNER_APP_INSTALLED manda o waba_id dentro de waba_info; é bem
  // provável que PARTNER_REMOVED não tenha esse waba_info (padrão comum
  // nos outros webhooks account_update da Meta, que só trazem o id no
  // nível do entry) — por isso o código nunca achava o waba_id nesse
  // caso e pulava o evento inteiro. entryWabaId cobre esse caso.
  const wabaId = (typeof wabaInfo?.waba_id === "string" ? (wabaInfo.waba_id as string) : null) ?? entryWabaId;
  const ownerBusinessId = typeof wabaInfo?.owner_business_id === "string" ? (wabaInfo.owner_business_id as string) : null;

  if (event === "PARTNER_REMOVED" && wabaId) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("whatsapp_instances")
      .update({ status: "disconnected", last_synced_at: new Date().toISOString() })
      .eq("waba_id", wabaId);
    if (error) console.error("[whatsapp.webhook] falha ao marcar desconectado após PARTNER_REMOVED:", error.message);
    else console.info(`[whatsapp.webhook] waba ${wabaId} desconectada pelo cliente (PARTNER_REMOVED) — CRM atualizado.`);
    return;
  }
  if (event === "PARTNER_REMOVED" && !wabaId) {
    // Se isso aparecer nos logs, quer dizer que nem o entry.id ajudou —
    // precisa olhar o payload completo (log acima) pra achar onde a
    // Meta escondeu o id da WABA nesse caso específico.
    console.error("[whatsapp.webhook] PARTNER_REMOVED recebido, mas não achei o waba_id em lugar nenhum do payload.");
    return;
  }

  if ((event !== "PARTNER_APP_INSTALLED" && event !== "PARTNER_ADDED") || !wabaId) return;

  const systemToken = process.env.META_SYSTEM_USER_TOKEN;
  if (!systemToken) {
    console.warn(
      `[whatsapp.webhook] ${event} recebido, mas META_SYSTEM_USER_TOKEN não configurado — conexão não foi salva.`,
    );
    return;
  }

  try {

    // Mesma proteção contra corrida que o fluxo interativo já tem: a
    // Meta pode disparar esse webhook um instante antes de terminar de
    // propagar o número — tenta de novo por até ~10s antes de desistir.
    let phonesJson: Json = { data: [] };
    let phoneNumberId: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const phonesRes = await fetch(
        `${graphUrl(`${wabaId}/phone_numbers?fields=id,display_phone_number,platform_type`)}&access_token=${encodeURIComponent(systemToken)}`,
      );
      phonesJson = (await phonesRes.json()) as Json;
      if (!phonesRes.ok) {
        const errMsg = (phonesJson.error as Json | undefined)?.message;
        throw new Error(typeof errMsg === "string" ? errMsg : `HTTP ${phonesRes.status}`);
      }
      const candidate = (Array.isArray(phonesJson.data) ? (phonesJson.data[0] as Json | undefined) : undefined) ?? {};
      phoneNumberId = typeof candidate.id === "string" ? candidate.id : null;
      if (phoneNumberId) break;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    const first = (Array.isArray(phonesJson.data) ? (phonesJson.data[0] as Json | undefined) : undefined) ?? {};
    const phone = typeof first.display_phone_number === "string" ? first.display_phone_number : null;
    // "SMB_APP" = o número ficou em modo Coexistência (o dono continua
    // usando o app do celular normalmente, junto com a API) — faltava
    // pedir esse campo aqui; o fluxo interativo (cloud.server.ts) já
    // pedia certo, só esse caminho (Integração Zero) esquecia.
    const platform = (typeof first.platform_type === "string" ? first.platform_type : "").toUpperCase();
    const isCoexistence = platform === "SMB_APP";
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
    // A Meta não manda NENHUM jeito de saber qual barbearia iniciou esse
    // vínculo (o link de Integração Zero não carrega state customizado)
    // — não dá pra saber automaticamente. Guarda como PENDENTE; um admin
    // confere manualmente (pelo telefone/nome) e reivindica pra
    // barbearia certa em /admin/whatsapp-pendentes. Antes isso "chutava"
    // direto pra conta admin — funcionava só enquanto era só o Mariano
    // testando, mas contaminava a conta admin de verdade assim que um
    // cliente de verdade usasse esse caminho (foi o que aconteceu com o
    // Isaque Bihain).
    const payload = {
      waba_id: wabaId,
      phone_number_id: phoneNumberId,
      phone,
      meta_access_token: systemToken,
      meta_business_id: ownerBusinessId,
      is_coexistence: isCoexistence,
    };
    const { error } = await supabaseAdmin
      .from("pending_meta_connections")
      .upsert(payload, { onConflict: "waba_id" });
    if (error) throw new Error(error.message);
    console.info(`[whatsapp.webhook] Conexão via Integração Zero PENDENTE de atribuir: waba=${wabaId} phone=${phone}`);
  } catch (e) {
    console.error(`[whatsapp.webhook] falha ao processar ${event}:`, e instanceof Error ? e.message : e);
  }
}

async function handleMessagesChange(change: Json) {
  console.info("[whatsapp.webhook] messages recebido:", JSON.stringify(change).slice(0, 2000));
  // Ingestão de mensagens normais pro resto do sistema (funil, etc.)
  // continua vindo por outro caminho (sincronização via extensão) — o que
  // ESTE webhook trata de verdade é confirmação de agendamento, de duas
  // formas: clique num botão de resposta rápida do modelo (mensagem tipo
  // "button", casa pelo WAMID em `context.id`), ou resposta DIGITADA
  // (mensagem tipo "text" — casa pelo número de telefone com a
  // confirmação pendente mais recente, e compara o texto contra as
  // palavras configuradas na regra).
  try {
    const value = (change.value as Json | undefined) ?? {};
    const metadata = (value.metadata as Json | undefined) ?? {};
    const phoneNumberId = typeof metadata.phone_number_id === "string" ? metadata.phone_number_id : null;
    const messages = Array.isArray(value.messages) ? (value.messages as Json[]) : [];
    for (const msg of messages) {
      if (msg.type === "button") {
        const button = msg.button as Json | undefined;
        const context = msg.context as Json | undefined;
        const repliedToWamid = typeof context?.id === "string" ? context.id : null;
        const buttonText = typeof button?.text === "string" ? button.text : null;
        if (repliedToWamid && buttonText) {
          await handleConfirmationButtonReply(repliedToWamid, buttonText);
        }
      } else if (msg.type === "text") {
        const textObj = msg.text as Json | undefined;
        const body = typeof textObj?.body === "string" ? textObj.body : null;
        const from = typeof msg.from === "string" ? msg.from : null;
        if (body && from && phoneNumberId) {
          await handleConfirmationTextReply(phoneNumberId, from, body);
        }
      }
    }
  } catch (e) {
    console.error("[whatsapp.webhook] falha ao processar mensagem recebida:", e);
  }
}

/** Casa o clique num botão de volta com o envio original (via WAMID) e,
 * se o texto do botão bater com o configurado na regra como "botão de
 * confirmar", muda o agendamento pra confirmed sozinho. */
async function handleConfirmationButtonReply(repliedToWamid: string, buttonText: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: job } = await supabaseAdmin
    .from("message_jobs")
    .select("id, appointment_id, agenda_reminder_rule_id")
    .eq("provider_message_id", repliedToWamid)
    .maybeSingle();
  if (!job?.appointment_id || !job.agenda_reminder_rule_id) return;

  const { data: rule } = await supabaseAdmin
    .from("agenda_reminder_rules")
    .select("confirm_button_text")
    .eq("id", job.agenda_reminder_rule_id)
    .maybeSingle();
  const expected = (rule?.confirm_button_text || "").trim().toLowerCase();
  if (!expected || buttonText.trim().toLowerCase() !== expected) {
    // Clicou em outro botão do mesmo modelo (ex: "Cancelar") — não é o
    // de confirmar, não faz nada automaticamente por enquanto.
    return;
  }

  await confirmAppointment(job.appointment_id, "botão");
}

/** Casa uma resposta DIGITADA (não clique) com a confirmação pendente
 * mais recente daquele número de telefone — não tem WAMID de contexto
 * pra casar direto, então usa telefone + "ainda não confirmado" + janela
 * de tempo recente. Se o texto bater com alguma palavra configurada na
 * regra (sim, ok, confirmo...), confirma. */
async function handleConfirmationTextReply(phoneNumberId: string, fromPhone: string, text: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { textMatchesConfirmKeywords } = await import("@/lib/agenda-reminders");

  const { data: instance } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("barbershop_id")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  if (!instance?.barbershop_id) return;

  const normalizedPhone = fromPhone.replace(/\D/g, "");
  const sinceIso = new Date(Date.now() - 48 * 3600_000).toISOString();

  // Confirmação pendente mais recente pra esse telefone: job criado por
  // uma regra de confirmação, enviado (não falho/pendente), dentro da
  // janela de 48h, cujo agendamento ainda não está confirmed.
  const { data: candidates } = await supabaseAdmin
    .from("message_jobs")
    .select("id, appointment_id, agenda_reminder_rule_id, sent_at, appointments!inner(status)")
    .eq("barbershop_id", instance.barbershop_id)
    .eq("phone", normalizedPhone)
    .not("agenda_reminder_rule_id", "is", null)
    .not("appointment_id", "is", null)
    .eq("status", "sent")
    .gte("sent_at", sinceIso)
    .order("sent_at", { ascending: false })
    .limit(5);
  if (!candidates?.length) return;

  for (const job of candidates) {
    const appt = job.appointments as unknown as { status: string } | null;
    if (appt?.status === "confirmed") continue; // já confirmado, ignora
    const { data: rule } = await supabaseAdmin
      .from("agenda_reminder_rules")
      .select("kind, confirm_keywords")
      .eq("id", job.agenda_reminder_rule_id as string)
      .maybeSingle();
    if (rule?.kind !== "confirmation") continue;
    const keywords = (rule.confirm_keywords as string[] | null) || [];
    if (!keywords.length || !textMatchesConfirmKeywords(text, keywords)) continue;
    await confirmAppointment(job.appointment_id as string, "texto digitado");
    return; // só a confirmação mais recente que bateu, não continua olhando as outras
  }
}

async function confirmAppointment(appointmentId: string, via: "botão" | "texto digitado") {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("appointments")
    .update({ status: "confirmed" })
    .eq("id", appointmentId);
  if (error) {
    console.error(`[whatsapp.webhook] falha ao confirmar agendamento via ${via}:`, error.message);
  } else {
    console.info(`[whatsapp.webhook] agendamento confirmado via ${via}:`, appointmentId);
  }
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
                await handleAccountUpdate(change, typeof entry.id === "string" ? entry.id : null);
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
