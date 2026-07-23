// wa-bridge — MAIN world. Recebe {__crm:"send", id, phone, text} e envia silenciosamente via WPP (wa-js).
// WhatsApp Web atual exige resolver PN -> LID antes do envio para novos chats.
(function () {
  const BRIDGE_VERSION = "0.17.0";
  if (window.__crmWaBridgeVersion === BRIDGE_VERSION) return;
  window.__crmWaBridgeVersion = BRIDGE_VERSION;

  function normalize(phone) {
    const only = String(phone || "").replace(/\D/g, "");
    return only.startsWith("55") ? only : "55" + only;
  }

  function serializeWid(wid) {
    if (!wid) return null;
    if (typeof wid === "string") return wid;
    if (typeof wid._serialized === "string") return wid._serialized;
    if (typeof wid.toString === "function") return wid.toString();
    return null;
  }

  function normalizeSerializedWid(value) {
    const serialized = serializeWid(value);
    if (!serialized) return null;
    return serialized.includes("@") ? serialized : `${serialized}@lid`;
  }

  function pickBestWid(info) {
    const direct = normalizeSerializedWid(info?.wid);
    const lid = normalizeSerializedWid(info?.lid || info?.lidWid || info?.contact?.lid);
    const pn = normalizeSerializedWid(info?.phoneNumber || info?.pn || info?.contact?.id);
    if (lid && lid.endsWith("@lid")) return lid;
    if (direct && direct.endsWith("@lid")) return direct;
    if (pn && pn.endsWith("@lid")) return pn;
    return direct || pn || null;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function pushWid(list, wid, prefer = false) {
    if (!wid || list.includes(wid)) return;
    if (prefer) list.unshift(wid);
    else list.push(wid);
  }

  async function queryWid(number, suffix) {
    const phoneWid = `${number}@c.us`;
    const found = [];
    try {
      if (window.WPP.contact?.queryWidExists) {
        const info = await window.WPP.contact.queryWidExists(phoneWid, suffix);
        pushWid(found, pickBestWid(info), true);
      }
    } catch (e) {
      console.warn("[CRM wa-bridge] contact.queryWidExists falhou", e);
    }
    try {
      if (window.WPP.whatsapp?.functions?.queryWidExists) {
        const info = await window.WPP.whatsapp.functions.queryWidExists(phoneWid, suffix);
        pushWid(found, pickBestWid(info), true);
      }
    } catch (e) {
      console.warn("[CRM wa-bridge] whatsapp.queryWidExists falhou", e);
    }
    return found;
  }

  async function waitForLid(number, timeoutMs = 3500) {
    const phoneWid = `${number}@c.us`;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const entry = await window.WPP.contact?.getPnLidEntry?.(phoneWid);
        const wid = pickBestWid(entry);
        if (wid && wid.endsWith("@lid")) return wid;
      } catch (e) {
        console.warn("[CRM wa-bridge] aguardando LID falhou", e);
      }
      await sleep(250);
    }
    return null;
  }

  async function resolveChatTarget(wid) {
    try {
      const chat = await window.WPP.chat?.find?.(wid);
      return serializeWid(chat?.id) || serializeWid(chat?.wid) || wid;
    } catch {
      return wid;
    }
  }

  async function waitReady(timeoutMs = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ready = typeof window.WPP?.isReady === "function" ? window.WPP.isReady() : window.WPP?.isReady;
      if (window.WPP && ready) return true;
      await sleep(500);
    }
    return false;
  }

  async function resolveWid(number) {
    const phoneWid = `${number}@c.us`;
    const possible = [phoneWid];

    // Primeiro tenta APIs que sincronizam PN -> LID.
    (await queryWid(number, "crm-barber")).forEach((wid) => pushWid(possible, wid, true));

    // Não usa sleep fixo: espera o cache PN/LID aparecer de verdade.
    pushWid(possible, await waitForLid(number), true);

    // Depois consulta o mapeamento local PN <-> LID. Se existir LID, ele é preferível.
    try {
      const entry = await window.WPP.contact?.getPnLidEntry?.(phoneWid);
      const wid = pickBestWid(entry);
      pushWid(possible, wid, true);
    } catch (e) {
      console.warn("[CRM wa-bridge] getPnLidEntry falhou", e);
    }

    // Compat legado: queryExists antigo também precisa receber @c.us, não só dígitos.
    try {
      const info = await window.WPP.contact?.queryExists?.(phoneWid);
      const wid = pickBestWid(info);
      pushWid(possible, wid);
    } catch (e) {
      console.warn("[CRM wa-bridge] queryExists falhou", e);
    }

    return [...new Set(possible)].filter(Boolean);
  }

  async function sendWithFallback(number, text) {
    let wids = await resolveWid(number);
    let lastError = null;

    for (const wid of wids) {
      try {
        const target = await resolveChatTarget(wid);
        console.info("[CRM wa-bridge] enviando", target);
        return await window.WPP.chat.sendTextMessage(target, text, { waitForAck: true, createChat: true, delay: 250 });
      } catch (e) {
        lastError = e;
        console.warn("[CRM wa-bridge] sendTextMessage falhou", wid, e);
      }
    }

    // Retry sempre, sem depender do texto do erro. WA pode retornar erros sem a palavra LID.
    (await queryWid(number, "crm-barber-retry")).forEach((wid) => pushWid(wids, wid, true));
    pushWid(wids, await waitForLid(number, 5000), true);

    for (const wid of wids) {
      try {
        const target = await resolveChatTarget(wid);
        console.info("[CRM wa-bridge] retry", target);
        return await window.WPP.chat.sendTextMessage(target, text, { waitForAck: true, createChat: true, delay: 250 });
      } catch (e) {
        lastError = e;
        console.warn("[CRM wa-bridge] retry falhou", wid, e);
      }
    }

    throw lastError || new Error("Não foi possível resolver/enviar para este número");
  }

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window) return;
    if (window.__crmWaBridgeVersion !== BRIDGE_VERSION) return;
    const d = ev.data;
    if (!d || d.__crm !== "send_v170") return;
    try {
      const ready = await waitReady();
      if (!ready) throw new Error("WhatsApp Web ainda não carregou");
      const to = normalize(d.phone);
      await sendWithFallback(to, String(d.text || ""));
      window.postMessage({ __crm: "sent_v170", id: d.id, ok: true }, "*");
    } catch (e) {
      window.postMessage({ __crm: "sent_v170", id: d.id, ok: false, error: (e && e.message) || "erro" }, "*");
    }
  });
})();
