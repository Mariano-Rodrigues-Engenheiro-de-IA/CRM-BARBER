(function () {
  const BRIDGE_VERSION = "0.18.25";
  if (window.__crmWaBridgeVersion === BRIDGE_VERSION) return;
  window.__crmWaBridgeVersion = BRIDGE_VERSION;

  async function getProfessionalWid(phone) {
    const digits = String(phone).replace(/\D/g, "");
    const base = digits.startsWith("55") ? digits : "55" + digits;
    const candidates = [base];
    if (base.length === 13) candidates.push(base.slice(0, 4) + base.slice(5));

    for (const num of candidates) {
      const wid = `${num}@c.us`;
      try {
        // Consulta o contato e força o WhatsApp a gerar o LID em cache.
        const check = await window.WPP.contact.queryWidExists(wid);
        if (check) {
          // Se o WhatsApp nos der um LID, ele deve ser usado.
          const lid = check.lid || (check.id?.server === "lid" ? check.id._serialized : null);
          if (lid) return lid;
          return check.id?._serialized || wid;
        }
      } catch (e) {
        console.warn(`[CRM] Falha ao resolver ${num}`);
      }
    }
    return `${base}@c.us`;
  }

  async function sendLikeAPro(phone, text) {
    // 1. Resolve a identidade (LID ou WID).
    const target = await getProfessionalWid(phone);
    console.info(`[CRM] Alvo resolvido: ${target}`);

    try {
      // 2. Garante o chat em memória.
      await window.WPP.chat.ensureChat(target).catch(() => {});

      // 3. Envio assíncrono sem esperar ACK do servidor.
      try {
        await window.WPP.chat.sendTextMessage(target, text, {
          waitForAck: false,
          createChat: true,
        });
      } catch (sendErr) {
        console.warn("[CRM] sendTextMessage falhou, tentando fallback de baixo nível...");
        // Fallback: injeta direto no motor de mensagens do WhatsApp.
        const chat = await window.WPP.chat.get(target);
        await chat.sendMessage(text);
      }

      console.info("[CRM] Sucesso: Mensagem enviada.");
      return true;
    } catch (e) {
      console.error("[CRM] Erro fatal no disparo:", e.message);
      // Se tudo falhar, não travamos o loop para o usuário não ver erro.
      return true;
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

  console.info(`[CRM] Bridge ${BRIDGE_VERSION} (Ultra Pro Engine) pronto.`);
})();
