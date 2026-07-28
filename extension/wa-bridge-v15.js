(function () {
  const BRIDGE_VERSION = "0.19.1";
  if (window.__crmWaBridgeVersion === BRIDGE_VERSION) return;
  window.__crmWaBridgeVersion = BRIDGE_VERSION;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function normalizePhone(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (!digits) throw new Error("Telefone inválido");
    return digits.startsWith("55") ? digits : `55${digits}`;
  }

  function toWid(phone) {
    return `${normalizePhone(phone)}@c.us`;
  }

  function serialized(value) {
    if (!value) return null;
    if (typeof value === "string") return value;
    return value._serialized ||
      value.serialized ||
      value.id?._serialized ||
      value.wid?._serialized ||
      value.jid?._serialized ||
      value.contact?.id?._serialized ||
      null;
  }

  async function waitForWpp() {
    for (let i = 0; i < 30; i += 1) {
      if (window.WPP?.chat) return;
      await sleep(500);
    }
    throw new Error("WhatsApp ainda não carregou o motor interno. Atualize o WhatsApp Web e tente de novo.");
  }

  async function tryStep(label, fn) {
    try {
      const result = await fn();
      console.info(`[CRM] ${label}: ok`);
      return { ok: true, result };
    } catch (e) {
      console.warn(`[CRM] ${label}: ${e?.message || e}`);
      return { ok: false, error: e?.message || String(e) };
    }
  }

  async function resolveTarget(phone) {
    const wid = toWid(phone);

    // Não usamos mais WPP.contact.getProfile: essa função saiu da build atual
    // do WhatsApp/wa-js e quebrava abrir conversa + respostas rápidas.
    const resolvers = [
      async () => {
        if (typeof window.WPP?.contact?.queryExists !== "function") throw new Error("queryExists indisponível");
        const res = await window.WPP.contact.queryExists(wid);
        return serialized(res) || serialized(res?.wid) || serialized(res?.id);
      },
      async () => {
        if (typeof window.WPP?.contact?.queryWidExists !== "function") throw new Error("queryWidExists indisponível");
        const res = await window.WPP.contact.queryWidExists(wid);
        return serialized(res) || serialized(res?.wid) || serialized(res?.id);
      },
      async () => {
        if (typeof window.WPP?.chat?.get !== "function") throw new Error("chat.get indisponível");
        const chat = await window.WPP.chat.get(wid);
        return serialized(chat) || serialized(chat?.id);
      },
    ];

    for (const resolver of resolvers) {
      const result = await resolver().catch(() => null);
      if (result) return result;
    }
    return wid;
  }

  async function openChat(phone) {
    await waitForWpp();
    const target = await resolveTarget(phone);
    const attempts = [
      ["openChatBottom", () => window.WPP.chat.openChatBottom(target)],
      ["openChatAt", () => window.WPP.chat.openChatAt(target)],
      ["openChat", () => window.WPP.chat.openChat(target)],
    ].filter(([, fn]) => typeof fn === "function");

    let lastError = "Não foi possível abrir a conversa";
    for (const [label, fn] of attempts) {
      const result = await tryStep(label, fn);
      if (result.ok) return target;
      lastError = result.error || lastError;
    }

    window.location.href = `https://web.whatsapp.com/send?phone=${normalizePhone(phone)}`;
    await sleep(1200);
    return target;
  }

  async function sendTextToTarget(target, text) {
    const chat = await window.WPP.chat.get(target).catch(() => null);
    const attempts = [
      ["chat.sendMessage", () => {
        if (!chat || typeof chat.sendMessage !== "function") throw new Error("chat.sendMessage indisponível");
        return chat.sendMessage(text);
      }],
      ["sendTextMessage", () => {
        if (typeof window.WPP.chat.sendTextMessage !== "function") throw new Error("sendTextMessage indisponível");
        return window.WPP.chat.sendTextMessage(target, text, { waitForAck: false });
      }],
      ["MsgStore.addMsgAndSend", () => {
        const addMsgAndSend = window.WPP?.whatsapp?.MsgStore?.addMsgAndSend;
        if (typeof addMsgAndSend !== "function") throw new Error("MsgStore.addMsgAndSend indisponível");
        return addMsgAndSend.call(window.WPP.whatsapp.MsgStore, {
          to: target,
          body: text,
          type: "chat",
        });
      }],
    ];

    let lastError = "Motor de envio indisponível";
    for (const [label, fn] of attempts) {
      const result = await tryStep(label, fn);
      if (result.ok) return true;
      lastError = result.error || lastError;
    }
    throw new Error(lastError);
  }

  async function robustSend(phone, text) {
    await waitForWpp();
    const target = await resolveTarget(phone);
    console.log(`[CRM] Alvo resolvido: ${target}. Enviando...`);
    await sendTextToTarget(target, text);
    console.info(`[CRM] Sucesso: mensagem enviada para ${target}`);
    return true;
  }

  async function fetchBlob(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Falha ao baixar mídia (HTTP ${res.status})`);
    return res.blob();
  }

  async function sendMediaAction(target, action) {
    if (!action.url) throw new Error("Mídia sem URL");
    const blob = await fetchBlob(action.url);
    const file = new File([blob], action.filename || "arquivo", { type: action.mime || blob.type });
    const opts = { type: action.type === "audio" ? "audio" : action.type === "video" ? "video" : "image", waitForAck: false };
    if (action.caption) opts.caption = action.caption;
    if (action.type === "audio") opts.isPtt = true;
    await window.WPP.chat.sendFileMessage(target, file, opts);
  }

  /** Executa uma sequência de ações (texto/mídia) na conversa do contato. */
  async function runActions(phone, openOnly, actions) {
    await waitForWpp();
    const target = await resolveTarget(phone);
    if (openOnly) {
      await openChat(phone);
      return;
    }
    for (const action of actions || []) {
      if (action.type === "text") {
        if (!action.text) continue;
        await robustSend(phone, action.text);
      } else {
        await sendMediaAction(target, action);
      }
      await sleep(700);
    }
  }

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window || !ev.data?.__crm) return;
    const d = ev.data;

    if (d.__crm === "action_v190") {
      try {
        if (!window.WPP?.chat) await sleep(2000);
        await runActions(d.phone, d.openOnly, d.actions);
        window.postMessage({ __crm: "action_done_v190", id: d.id, ok: true }, "*");
      } catch (e) {
        window.postMessage({ __crm: "action_done_v190", id: d.id, ok: false, error: e?.message || String(e) }, "*");
      }
      return;
    }

    if (!["send_v180", "send_v170"].includes(d.__crm)) return;
    const ackType = d.__crm.replace("send", "sent");
    try {
      if (!window.WPP?.chat) await sleep(2000);
      await robustSend(d.phone, d.text);
      window.postMessage({ __crm: ackType, id: d.id, ok: true }, "*");
    } catch (e) {
      window.postMessage({ __crm: ackType, id: d.id, ok: false, error: e?.message || String(e) }, "*");
    }
  });

  console.info(`[CRM] Bridge ${BRIDGE_VERSION} (Native Engine) pronto.`);
})();

