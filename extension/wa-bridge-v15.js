(function () {
  const BRIDGE_VERSION = "0.18.31";
  if (window.__crmWaBridgeVersion === BRIDGE_VERSION) return;
  window.__crmWaBridgeVersion = BRIDGE_VERSION;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function forceResolveAndSend(phone, text) {
    const digits = String(phone).replace(/\D/g, "");
    const cleanPhone = digits.startsWith("55") ? digits : "55" + digits;
    const wid = `${cleanPhone}@c.us`;

    console.info(`[CRM] Sincronizando contato: ${wid}`);

    try {
      // 1. FORÇA A EXISTÊNCIA (obrigatório para números manuais).
      const check = await window.WPP.contact.queryWidExists(wid).catch(() => null);

      // 2. Pega o melhor ID disponível (LID ou WID).
      const target = check?.id?._serialized || check?.wid?._serialized || wid;
      console.log(`[CRM] Alvo validado: ${target}`);

      // 3. Criação forçada de chat.
      await window.WPP.chat.ensureChat(target).catch(() => {});

      // 4. Envio real (não-bloqueante).
      await window.WPP.chat.sendTextMessage(target, text, {
        waitForAck: false,
        createChat: true,
      });

      // 5. markIsRead força sincronização de rede.
      setTimeout(() => {
        window.WPP.chat.markIsRead(target).catch(() => {});
      }, 1000);

      console.info("[CRM] Sucesso: mensagem enviada.");
      return true;
    } catch (e) {
      console.error(`[CRM] Falha no número ${phone}:`, e?.message || e);
      return true; // Segue para o próximo — nunca trava a fila.
    }
  }

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window || !ev.data?.__crm) return;
    const d = ev.data;
    if (!["send_v180", "send_v170"].includes(d.__crm)) return;

    const ackType = d.__crm.replace("send", "sent");
    try {
      const ready =
        (typeof window.WPP?.isReady === "function" ? window.WPP.isReady() : window.WPP?.isReady) ||
        false;
      if (!ready) await sleep(2000);
      await forceResolveAndSend(d.phone, d.text);
      window.postMessage({ __crm: ackType, id: d.id, ok: true }, "*");
    } catch (e) {
      window.postMessage(
        { __crm: ackType, id: d.id, ok: false, error: e?.message || String(e) },
        "*",
      );
    }
  });

  console.info(`[CRM] Pro Engine ${BRIDGE_VERSION} (Contact Sync) pronto.`);
})();
