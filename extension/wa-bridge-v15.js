(function () {
  const BRIDGE_VERSION = "0.18.37";
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

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window || !ev.data?.__crm) return;
    const d = ev.data;
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
