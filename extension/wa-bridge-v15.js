// wa-bridge — MAIN world. Recebe {__crm:"send", id, phone, text} e envia silenciosamente via WPP (wa-js).
// WhatsApp Web atual exige resolver PN -> LID antes do envio para novos chats.
(function () {
  const BRIDGE_VERSION = "0.18.2";
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

  function isLid(wid) {
    return String(wid || "").endsWith("@lid");
  }

  function isPhoneWid(wid) {
    return String(wid || "").endsWith("@c.us");
  }

  function pickWids(info) {
    const direct = normalizeSerializedWid(info?.wid || info?.id);
    const lid = normalizeSerializedWid(info?.lid || info?.lidWid || info?.contact?.lid);
    const pn = normalizeSerializedWid(info?.phoneNumber || info?.pn || info?.contact?.id);
    const out = [];
    pushWid(out, lid, true);
    pushWid(out, direct, !lid && isLid(direct));
    pushWid(out, pn);
    return out;
  }

  function pickBestWid(info) {
    const [first] = pickWids(info);
    return first || null;
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
        pickWids(info).forEach((wid) => pushWid(found, wid, isLid(wid)));
      }
    } catch (e) {
      console.warn("[CRM wa-bridge] contact.queryWidExists falhou", e);
    }
    try {
      if (window.WPP.whatsapp?.functions?.queryWidExists) {
        const info = await window.WPP.whatsapp.functions.queryWidExists(phoneWid, suffix);
        pickWids(info).forEach((wid) => pushWid(found, wid, isLid(wid)));
      }
    } catch (e) {
      console.warn("[CRM wa-bridge] whatsapp.queryWidExists falhou", e);
    }
    return found;
  }

  async function waitForLid(number, timeoutMs = 12000) {
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
    const possible = [];

    // Primeiro tenta APIs que sincronizam PN -> LID.
    (await queryWid(number, "crm-barber")).forEach((wid) => pushWid(possible, wid, isLid(wid)));

    // Não usa sleep fixo: espera o cache PN/LID aparecer de verdade.
    pushWid(possible, await waitForLid(number), true);

    // Depois consulta o mapeamento local PN <-> LID. Se existir LID, ele é preferível.
    try {
      const entry = await window.WPP.contact?.getPnLidEntry?.(phoneWid);
      pickWids(entry).forEach((wid) => pushWid(possible, wid, isLid(wid)));
    } catch (e) {
      console.warn("[CRM wa-bridge] getPnLidEntry falhou", e);
    }

    // Compat legado: queryExists antigo também precisa receber @c.us, não só dígitos.
    try {
      const info = await window.WPP.contact?.queryExists?.(phoneWid);
      pickWids(info).forEach((wid) => pushWid(possible, wid, isLid(wid)));
    } catch (e) {
      console.warn("[CRM wa-bridge] queryExists falhou", e);
    }

    // chat.find usa o fluxo interno findOrCreateLatestChat da própria wa-js.
    // Em alguns WhatsApp Web ele resolve o chat mesmo quando getPnLidEntry não retorna LID.
    try {
      const chat = await window.WPP.chat?.find?.(phoneWid);
      pickWids(chat).forEach((wid) => pushWid(possible, wid, isLid(wid)));
    } catch (e) {
      console.warn("[CRM wa-bridge] chat.find por PN falhou", e);
    }

    // Fallback silencioso real: tentar @c.us por último, sem abrir conversa.
    // Se a conta exigir @lid e a lib não conseguir resolver, esse envio também falha
    // com erro explícito em vez de cair para modo visível.
    pushWid(possible, phoneWid);

    return [...new Set(possible)].filter(Boolean);
  }

  function errorMessage(error) {
    return String(error?.message || error || "erro desconhecido");
  }

  async function sendSilently(number, text) {
    let wids = await resolveWid(number);
    let lastError = null;

    for (const wid of wids) {
      try {
        const target = isPhoneWid(wid) ? wid : await resolveChatTarget(wid);
        console.info("[CRM wa-bridge] enviando", target);
        return await window.WPP.chat.sendTextMessage(target, text, { waitForAck: true, createChat: true, delay: 250 });
      } catch (e) {
        lastError = e;
        console.warn("[CRM wa-bridge] sendTextMessage falhou", wid, e);
      }
    }

    // Retry sempre, sem depender do texto do erro. WA pode retornar erros sem a palavra LID.
    (await queryWid(number, "crm-barber-retry")).forEach((wid) => pushWid(wids, wid, isLid(wid)));
    pushWid(wids, await waitForLid(number, 18000), true);
    pushWid(wids, `${number}@c.us`);
    wids = [...new Set(wids)].filter(Boolean);

    for (const wid of wids) {
      try {
        const target = isPhoneWid(wid) ? wid : await resolveChatTarget(wid);
        console.info("[CRM wa-bridge] retry", target);
        return await window.WPP.chat.sendTextMessage(target, text, { waitForAck: true, createChat: true, delay: 250 });
      } catch (e) {
        lastError = e;
        console.warn("[CRM wa-bridge] retry falhou", wid, e);
      }
    }

    throw new Error(`Envio silencioso falhou. A wa-js não conseguiu criar/enviar o chat por LID nem por @c.us. Último erro: ${errorMessage(lastError)}`);
  }

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window) return;
    if (window.__crmWaBridgeVersion !== BRIDGE_VERSION) return;
    const d = ev.data;
    if (!d || (d.__crm !== "send_v180" && d.__crm !== "send_v170")) return;
    try {
      const ready = await waitReady();
      if (!ready) throw new Error("WhatsApp Web ainda não carregou");
      const to = normalize(d.phone);
      await sendSilently(to, String(d.text || ""));
      window.postMessage({ __crm: d.__crm === "send_v180" ? "sent_v180" : "sent_v170", id: d.id, ok: true }, "*");
    } catch (e) {
      window.postMessage({ __crm: d.__crm === "send_v180" ? "sent_v180" : "sent_v170", id: d.id, ok: false, error: (e && e.message) || "erro" }, "*");
    }
  });
})();
