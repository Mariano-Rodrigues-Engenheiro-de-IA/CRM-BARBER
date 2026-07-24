(function () {
  const BRIDGE_VERSION = "0.18.20";
  if (window.__crmWaBridgeVersion === BRIDGE_VERSION) return;
  window.__crmWaBridgeVersion = BRIDGE_VERSION;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function serializeWid(wid) {
    if (!wid) return null;
    if (typeof wid === "string") return wid;
    return wid._serialized || wid.id?._serialized || wid.id || null;
  }

  function getPhoneCandidates(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (!digits) return [];
    const normalized = digits.startsWith("55") ? digits : `55${digits}`;
    const candidates = [normalized];

    // Brasil: tenta com e sem o nono dígito para contatos manuais.
    if (normalized.length === 13 && normalized.startsWith("55") && normalized[4] === "9") {
      candidates.push(normalized.slice(0, 4) + normalized.slice(5));
    } else if (normalized.length === 12 && normalized.startsWith("55")) {
      candidates.push(normalized.slice(0, 4) + "9" + normalized.slice(4));
    }

    return [...new Set(candidates)];
  }

  async function resolveWid(phone) {
    const candidates = getPhoneCandidates(phone);
    if (candidates.length === 0) throw new Error("Número inválido");

    let fallback = `${candidates[0]}@c.us`;
    for (const candidate of candidates) {
      const target = `${candidate}@c.us`;
      try {
        console.info(`[CRM] Buscando ID oficial para: ${target}`);
        const check = await window.WPP.contact.queryWidExists(target);
        const resolved = serializeWid(check?.wid || check?.id || check);
        if (resolved) {
          console.info(`[CRM] ID resolvido via queryWidExists: ${resolved}`);
          return resolved;
        }
      } catch (e) {
        console.warn(`[CRM] queryWidExists falhou para ${target}:`, e?.message || e);
      }

      try {
        const check = await window.WPP.contact.queryExists(target);
        const resolved = serializeWid(check?.wid || check?.id || check);
        if (resolved) {
          console.info(`[CRM] ID resolvido via queryExists: ${resolved}`);
          return resolved;
        }
      } catch (e) {
        console.warn(`[CRM] queryExists falhou para ${target}:`, e?.message || e);
      }
    }

    console.warn(`[CRM] LID não retornado pelo WhatsApp; tentando fallback ${fallback}`);
    return fallback;
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
    const wid = await resolveWid(phone);

    console.info(`[CRM] Iniciando disparo para: ${wid}`);

    try {
      const result = await window.WPP.chat.sendTextMessage(wid, text, {
        waitForAck: false,
        createChat: true,
      });

      const msgId = serializeWid(result?.id || result);

      console.info(`[CRM] Mensagem injetada${msgId ? ` (ID: ${msgId})` : ""}. Monitorando...`);

      const start = Date.now();
      while (Date.now() - start < 30000) {
        await sleep(2000);
        const msg = msgId ? await window.WPP.chat.getMessageById(msgId).catch(() => null) : null;
        const ack = msg?.ack ?? null;

        if (ack !== null && ack >= 1) {
          console.info("[CRM] Confirmado pelo servidor.");
          return true;
        }

        if (Date.now() - start > 10000 && ack === 0) {
          await window.WPP.chat.markIsRead(wid).catch(() => {});
          if (Date.now() - start > 20000) return true;
        }
      }
      return true;
    } catch (e) {
      console.error("[CRM] Erro no disparo:", e?.message || e);
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

  console.info(`[CRM] Bridge ${BRIDGE_VERSION} (LID Resolution) pronto.`);
})();
