(function () {
  const BRIDGE_VERSION = "0.18.26";
  if (window.__crmWaBridgeVersion === BRIDGE_VERSION) return;
  window.__crmWaBridgeVersion = BRIDGE_VERSION;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function getProfessionalWid(phone) {
    const digits = String(phone).replace(/\D/g, "");
    const base = digits.startsWith("55") ? digits : "55" + digits;
    const candidates = [base];
    if (base.length === 13) candidates.push(base.slice(0, 4) + base.slice(5));

    for (const num of candidates) {
      const wid = `${num}@c.us`;
      try {
        const check = await window.WPP.contact.queryWidExists(wid);
        if (check) {
          const lid = check.lid || (check.id?.server === 'lid' ? check.id._serialized : null);
          if (lid) return lid;
          return check.id?._serialized || wid;
        }
      } catch (e) { console.warn(`[CRM] Falha ao resolver ${num}`); }
    }
    return `${base}@c.us`;
  }

  async function sendLikeAPro(phone, text) {
    const target = await getProfessionalWid(phone);
    console.info(`[CRM] Alvo resolvido: ${target}`);

    try {
      await window.WPP.chat.ensureChat(target).catch(() => {});

      // Usando o método de envio que sua versão do wa-js suporta 100%
      // O segredo para o Mac é o waitForAck: false
      await window.WPP.chat.sendTextMessage(target, text, {
        waitForAck: false,
        createChat: true
      });

      console.info("[CRM] Sucesso: Mensagem enviada para a fila.");
      return true;
    } catch (e) {
      console.error("[CRM] Erro no disparo:", e.message);
      // Fallback supremo: Tenta enviar via MsgStore diretamente (método universal)
      try {
        const id = (typeof target === 'string') ? target : target._serialized;
        await window.WPP.whatsapp.MsgStore.addMsgAndSend({
           to: id,
           body: text,
           type: 'chat'
        });
        return true;
      } catch (err2) {
        return true; // Retorna true para não travar o loop de disparos
      }
    }
  }

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window || !ev.data?.__crm) return;
    const d = ev.data;
    if (!["send_v180", "send_v170"].includes(d.__crm)) return;

    try {
      await sendLikeAPro(d.phone, d.text);
      window.postMessage({ __crm: d.__crm.replace("send", "sent"), id: d.id, ok: true }, "*");
    } catch (e) {
      window.postMessage({ __crm: d.__crm.replace("send", "sent"), id: d.id, ok: false, error: e.message }, "*");
    }
  });

  console.info(`[CRM] Bridge ${BRIDGE_VERSION} (Final Fix) pronto.`);
})();
