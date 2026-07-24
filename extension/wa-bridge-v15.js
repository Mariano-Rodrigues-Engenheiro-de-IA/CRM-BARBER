(function () {
  const BRIDGE_VERSION = "0.18.17";
  if (window.__crmWaBridgeVersion === BRIDGE_VERSION) return;
  window.__crmWaBridgeVersion = BRIDGE_VERSION;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function serializeWid(wid) {
    if (!wid) return null;
    if (typeof wid === "string") return wid;
    return wid._serialized || wid.id?._serialized || wid.id || null;
  }

  async function resolveWid(number) {
    const digits = String(number).replace(/\D/g, "");
    const phone = digits.startsWith("55") ? digits : "55" + digits;
    const phoneWid = `${phone}@c.us`;

    try {
      const check = await window.WPP.contact.queryWidExists(phoneWid);
      if (check) {
        const lid = check.lid || (typeof check.id === "object" && check.id?.server === "lid" ? check.id._serialized : null);
        if (lid) return lid;
        return serializeWid(check.id || check);
      }
    } catch (e) {
      console.warn("[CRM] Falha na consulta de LID, tentando fallback...", e);
    }
    return phoneWid;
  }

  function getAck(result) {
    return result?.ack ?? result?.msg?.ack ?? result?.message?.ack ?? null;
  }

  async function waitReady(timeout = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const wpp = window.WPP;
      if (wpp && (typeof wpp.isReady === "function" ? wpp.isReady() : wpp.isReady)) {
        if (wpp.chat && wpp.contact) return true;
      }
      await sleep(1000);
    }
    return false;
  }

  async function robustSend(phone, text) {
    const wid = await resolveWid(phone);
    console.info(`[CRM] Enviando para ${wid}...`);

    try {
      const result = await window.WPP.chat.sendTextMessage(wid, text, {
        waitForAck: false,
        createChat: true,
      });

      const msgId = serializeWid(result.id || result);

      const start = Date.now();
      while (Date.now() - start < 35000) {
        await sleep(2000);
        const msg = await window.WPP.chat.getMessageById(msgId).catch(() => null);
        const currentAck = getAck(msg);

        if (currentAck !== null && currentAck >= 1) {
          console.info("[CRM] Sucesso: Mensagem confirmada.");
          return true;
        }

        if (Date.now() - start > 12000 && currentAck === 0) {
          await window.WPP.chat.markIsRead(wid).catch(() => {});
          if (Date.now() - start > 20000) {
            console.warn("[CRM] Timeout de confirmação no Mac, assumindo sucesso.");
            return true;
          }
        }
      }
      return true;
    } catch (e) {
      console.error("[CRM] Erro no disparo:", e);
      throw e;
    }
  }

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window || !ev.data?.__crm) return;
    const d = ev.data;
    if (!["send_v180", "send_v170"].includes(d.__crm)) return;

    try {
      const isReady = await waitReady();
      if (!isReady) throw new Error("WhatsApp não está pronto.");

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

  console.info(`[CRM] Bridge ${BRIDGE_VERSION} (LID + Mac Fix) carregado.`);
})();
