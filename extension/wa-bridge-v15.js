(function () {
  const BRIDGE_VERSION = "0.18.19";
  if (window.__crmWaBridgeVersion === BRIDGE_VERSION) return;
  window.__crmWaBridgeVersion = BRIDGE_VERSION;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function getWid(phone) {
    const digits = String(phone).replace(/\D/g, "");
    if (!digits) return null;
    return digits.length >= 12 ? `${digits}@c.us` : `55${digits}@c.us`;
  }

  async function waitReady(timeout = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const wpp = window.WPP;
      if (wpp && (typeof wpp.isReady === "function" ? wpp.isReady() : wpp.isReady)) {
        if (wpp.chat) return true;
      }
      await sleep(1000);
    }
    return false;
  }

  async function robustSend(phone, text) {
    let wid = getWid(phone);
    if (!wid) throw new Error("Número inválido");

    console.info(`[CRM] Disparando para: ${wid}`);

    try {
      try {
        const check = await Promise.race([
          window.WPP.contact.queryWidExists(wid),
          sleep(500).then(() => null),
        ]);
        if (check?.wid?._serialized) wid = check.wid._serialized;
        else if (check?.id?._serialized) wid = check.id._serialized;
      } catch (e) {
        console.warn("[CRM] Ignorando falha de consulta de LID...");
      }

      const result = await window.WPP.chat.sendTextMessage(wid, text, {
        waitForAck: false,
        createChat: true,
      });

      const msgId =
        result.id?._serialized || result.id || (typeof result === "string" ? result : null);

      console.info(`[CRM] Mensagem injetada. Monitorando...`);

      const start = Date.now();
      while (Date.now() - start < 25000) {
        await sleep(2500);
        const msg = msgId ? await window.WPP.chat.getMessageById(msgId).catch(() => null) : null;
        const ack = msg?.ack ?? null;

        if (ack !== null && ack >= 1) {
          console.info("[CRM] Sucesso confirmado.");
          return true;
        }

        if (Date.now() - start > 8000 && ack === 0) {
          await window.WPP.chat.markIsRead(wid).catch(() => {});
          if (Date.now() - start > 15000) return true;
        }
      }
      return true;
    } catch (e) {
      console.error("[CRM] Erro no envio:", e.message);
      throw e;
    }
  }

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window || !ev.data?.__crm) return;
    const d = ev.data;
    if (!["send_v180", "send_v170"].includes(d.__crm)) return;

    try {
      const isReady = await waitReady();
      if (!isReady) throw new Error("WhatsApp não pronto.");

      await robustSend(d.phone, d.text);

      window.postMessage(
        { __crm: d.__crm.replace("send", "sent"), id: d.id, ok: true },
        "*",
      );
    } catch (e) {
      window.postMessage(
        { __crm: d.__crm.replace("send", "sent"), id: d.id, ok: false, error: e.message },
        "*",
      );
    }
  });

  console.info(`[CRM] Bridge ${BRIDGE_VERSION} (Mac Force Send) pronto.`);
})();
