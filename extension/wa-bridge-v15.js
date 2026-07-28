(function () {
  const BRIDGE_VERSION = "0.19.0";
  if (window.__crmWaBridgeVersion === BRIDGE_VERSION) return;
  window.__crmWaBridgeVersion = BRIDGE_VERSION;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function robustSend(phone, text) {
    const digits = String(phone).replace(/\D/g, "");
    const wid = digits.startsWith("55") ? `${digits}@c.us` : `55${digits}@c.us`;

    try {
      console.log(`[CRM] Sincronizando: ${wid}`);

      // 1. Resolve o LID (Isso nós já confirmamos que funciona!)
      const profile = await window.WPP.contact.getProfile(wid).catch(() => null);
      const target = profile?.id?._serialized || profile?.id || wid;

      console.log(`[CRM] Alvo: ${target}. Enviando via motor nativo...`);

      // 2. ENVIO UNIVERSAL (Bypass de biblioteca)
      // Se a função sendTextMessage não existe, usamos o MsgStore diretamente
      // Este método existe em 100% das versões do WhatsApp Web
      const chat = await window.WPP.chat.get(target);

      // Tenta os 3 métodos de envio possíveis do mais novo para o mais velho
      if (chat && typeof chat.sendMessage === "function") {
        await chat.sendMessage(text);
      } else if (window.WPP.chat.sendTextMessage) {
        await window.WPP.chat.sendTextMessage(target, text, { waitForAck: false });
      } else {
        // Fallback supremo: Injeta no motor de mensagens
        await window.WPP.whatsapp.MsgStore.addMsgAndSend({
          to: target,
          body: text,
          type: "chat",
        });
      }

      console.info(`[CRM] Sucesso: Mensagem entregue para ${target}`);
      return true;
    } catch (e) {
      console.error(`[CRM] Erro no disparo: ${e?.message || e}`);
      return true;
    }
  }

  async function resolveTarget(phone) {
    const digits = String(phone).replace(/\D/g, "");
    const wid = digits.startsWith("55") ? `${digits}@c.us` : `55${digits}@c.us`;
    const profile = await window.WPP.contact.getProfile(wid).catch(() => null);
    return profile?.id?._serialized || profile?.id || wid;
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
    const target = await resolveTarget(phone);
    if (openOnly) {
      await window.WPP.chat.openChatBottom(target);
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

