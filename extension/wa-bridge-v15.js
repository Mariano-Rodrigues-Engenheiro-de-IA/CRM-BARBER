(function () {
  const BRIDGE_VERSION = "0.18.21";
  if (window.__crmWaBridgeVersion === BRIDGE_VERSION) return;
  window.__crmWaBridgeVersion = BRIDGE_VERSION;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function serializeWid(wid) {
    if (!wid) return null;
    return typeof wid === "string" ? wid : (wid._serialized || wid.id?._serialized || wid.id || null);
  }

  // RESOLVEDOR DEFINITIVO: Tenta 3 métodos diferentes para achar o ID (LID)
  async function resolveWid(number) {
    const digits = String(number).replace(/\D/g, "");
    const phone = digits.startsWith("55") ? digits : "55" + digits;
    const phoneWid = `${phone}@c.us`;

    try {
      console.log(`[CRM] Resolvendo identidade para: ${phoneWid}`);

      // Método 1: Consulta de existência (popula o cache interno)
      const check = await window.WPP.contact.queryWidExists(phoneWid);

      // Método 2: Força o WhatsApp a converter para LID se disponível
      if (typeof window.WPP?.whatsapp?.toUserLid === "function") {
        const lid = await window.WPP.whatsapp.toUserLid(phoneWid).catch(() => null);
        if (lid) return serializeWid(lid);
      }

      // Método 3: Busca no resultado da consulta
      if (check) {
        const found =
          check.lid ||
          check.id?.lid ||
          (check.id?.server === "lid" ? check.id._serialized : null) ||
          serializeWid(check.id || check.wid);
        if (found) return found;
      }
    } catch (e) {
      console.warn(`[CRM] Falha na resolução: ${e.message}`);
    }
    return phoneWid;
  }

  async function robustSend(phone, text) {
    const wid = await resolveWid(phone);
    console.info(`[CRM] Alvo definido: ${wid}`);

    try {
      // PASSO CRUCIAL: Força o WhatsApp a carregar o chat e o LID em cache
      console.log("[CRM] Garantindo chat em memória...");
      await window.WPP.chat.ensureChat(wid).catch(() => {});

      // Envio sem esperar ACK (Bypass de Telemetria Mac)
      const result = await window.WPP.chat.sendTextMessage(wid, text, {
        waitForAck: false,
        createChat: true,
      });

      const msgId = serializeWid(result.id || result);
      console.info(`[CRM] Mensagem injetada (ID: ${msgId}).`);

      // Monitoramento passivo (Polling)
      const start = Date.now();
      while (Date.now() - start < 25000) {
        await sleep(2000);
        const msg = msgId ? await window.WPP.chat.getMessageById(msgId).catch(() => null) : null;
        const ack = msg?.ack ?? null;

        if (ack !== null && ack >= 1) {
          console.info("[CRM] Sucesso confirmado.");
          return true;
        }

        if (Date.now() - start > 10000 && ack === 0) {
          await window.WPP.chat.markIsRead(wid).catch(() => {});
          if (Date.now() - start > 18000) return true;
        }
      }
      return true;
    } catch (e) {
      // SE DER O ERRO "No LID", tentamos o último recurso: enviar direto pelo @c.us
      if (String(e?.message || "").includes("LID")) {
        console.warn("[CRM] Erro de LID detectado. Tentando envio via fallback de contato...");
        const digits = String(phone).replace(/\D/g, "");
        const raw = (digits.startsWith("55") ? digits : "55" + digits) + "@c.us";
        return await window.WPP.chat
          .sendTextMessage(raw, text, { waitForAck: false, createChat: true })
          .then(() => true);
      }
      throw e;
    }
  }

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window || !ev.data?.__crm) return;
    const d = ev.data;
    if (!["send_v180", "send_v170"].includes(d.__crm)) return;

    try {
      const ready =
        typeof window.WPP?.isReady === "function" ? window.WPP.isReady() : !!window.WPP?.isReady;
      if (!ready) await sleep(2000);

      await robustSend(d.phone, d.text);
      window.postMessage({ __crm: d.__crm.replace("send", "sent"), id: d.id, ok: true }, "*");
    } catch (e) {
      window.postMessage(
        { __crm: d.__crm.replace("send", "sent"), id: d.id, ok: false, error: e.message },
        "*",
      );
    }
  });

  console.info(`[CRM] Bridge ${BRIDGE_VERSION} (Chat Ensure + LID Fix) pronto.`);
})();
