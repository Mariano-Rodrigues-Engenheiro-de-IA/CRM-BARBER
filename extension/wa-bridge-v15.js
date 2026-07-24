(function () {
  const BRIDGE_VERSION = "0.18.16";
  if (window.__crmWaBridgeVersion === BRIDGE_VERSION) return;
  window.__crmWaBridgeVersion = BRIDGE_VERSION;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function serializeWid(wid) {
    if (!wid) return null;
    if (typeof wid === "string") return wid;
    return wid._serialized || wid.id?._serialized || wid.id || null;
  }

  function getAck(result) {
    return result?.ack ?? result?.msg?.ack ?? result?.message?.ack ?? null;
  }

  // Versão robusta que aceita isReady como função ou booleano
  async function waitReady(timeout = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const wpp = window.WPP;
      if (wpp) {
        const ready = typeof wpp.isReady === "function" ? wpp.isReady() : wpp.isReady;
        if (ready && wpp.chat) return true;
      }
      await sleep(1000);
    }
    return false;
  }

  async function robustSend(phone, text) {
    console.info(`[CRM] Preparando envio para: ${phone}`);

    const digits = String(phone).replace(/\D/g, "");
    const wid = digits.includes("@")
      ? digits
      : (digits.length >= 12 ? `${digits}@c.us` : `55${digits}@c.us`);

    try {
      const result = await window.WPP.chat.sendTextMessage(wid, text, {
        waitForAck: false,
        createChat: true,
      });

      const msgId = serializeWid(result.id || result);
      console.info(`[CRM] Mensagem injetada. ID: ${msgId}. Aguardando ACK...`);

      const start = Date.now();
      while (Date.now() - start < 35000) {
        await sleep(2000);
        const msg = await window.WPP.chat.getMessageById(msgId).catch(() => null);
        const currentAck = getAck(msg);

        if (currentAck !== null && currentAck >= 1) {
          console.info("[CRM] Sucesso: ACK confirmado.");
          return true;
        }

        if (Date.now() - start > 12000 && currentAck === 0) {
          await window.WPP.chat.markIsRead(wid).catch(() => {});
          if (Date.now() - start > 20000) return true;
        }
      }
      return true;
    } catch (e) {
      console.error("[CRM] Erro no sendTextMessage:", e);
      throw e;
    }
  }

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window || !ev.data?.__crm) return;
    const d = ev.data;
    if (!["send_v180", "send_v170"].includes(d.__crm)) return;

    try {
      const isReady = await waitReady();
      if (!isReady) throw new Error("WPP não inicializado.");

      await robustSend(d.phone, d.text);

      window.postMessage({
        __crm: d.__crm.replace("send", "sent"),
        id: d.id,
        ok: true,
      }, "*");
    } catch (e) {
      window.postMessage({
        __crm: d.__crm.replace("send", "sent"),
        id: d.id,
        ok: false,
        error: e.message,
      }, "*");
    }
  });

  console.info(`[CRM] Bridge ${BRIDGE_VERSION} (Mac Fix) carregado.`);
})();
