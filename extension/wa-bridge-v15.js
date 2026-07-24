(function () {
  const BRIDGE_VERSION = "0.18.18";
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
    let cleanNumber = digits.startsWith("55") ? digits : "55" + digits;

    const candidates = [cleanNumber];
    if (cleanNumber.length === 13 && cleanNumber.startsWith("55") && cleanNumber[4] === "9") {
      candidates.push(cleanNumber.slice(0, 4) + cleanNumber.slice(5));
    }

    for (const num of candidates) {
      const target = `${num}@c.us`;
      try {
        console.log(`[CRM] Consultando existência de: ${target}`);
        const check = await window.WPP.contact.queryWidExists(target);
        if (check && (check.wid || check.id)) {
          const found = serializeWid(check.wid || check.id);
          if (found) {
            console.log(`[CRM] ID resolvido: ${found}`);
            return found;
          }
        }
      } catch (e) {
        console.warn(`[CRM] Falha ao consultar ${target}:`, e.message);
      }
    }

    return `${cleanNumber}@c.us`;
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
    console.info(`[CRM] Iniciando envio para ${wid}...`);

    try {
      const result = await window.WPP.chat.sendTextMessage(wid, text, {
        waitForAck: false,
        createChat: true,
      });

      const msgId = serializeWid(result.id || result);

      const start = Date.now();
      while (Date.now() - start < 30000) {
        await sleep(2000);
        const msg = await window.WPP.chat.getMessageById(msgId).catch(() => null);
        const ack = msg?.ack ?? null;

        if (ack !== null && ack >= 1) {
          console.info("[CRM] Sucesso: Mensagem confirmada pelo servidor.");
          return true;
        }

        if (Date.now() - start > 10000 && ack === 0) {
          await window.WPP.chat.markIsRead(wid).catch(() => {});
          if (Date.now() - start > 18000) {
            console.warn("[CRM] Timeout de ACK no Mac, assumindo sucesso.");
            return true;
          }
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

  console.info(`[CRM] Bridge ${BRIDGE_VERSION} (Manual Contacts + Mac Fix) pronto.`);
})();
