// wa-bridge — MAIN world. Recebe {__crm:"send", id, phone, text} e envia silenciosamente via WPP (wa-js).
// WhatsApp Web atual pode exigir LID para novos chats. Não usamos fallback visível.
(function () {
  const BRIDGE_VERSION = "0.18.6";
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

  function normalizeWid(value, server) {
    const serialized = serializeWid(value);
    if (!serialized) return null;
    if (serialized.includes("@")) return serialized;
    const digits = serialized.replace(/\D/g, "");
    if (!digits) return null;
    return `${digits}@${server}`;
  }

  function pickWids(info) {
    const direct = normalizeWid(info?.wid || info?.id, "c.us");
    const lid = normalizeWid(info?.lid || info?.lidWid || info?.contact?.lid || info?.contact?.lidWid, "lid");
    const pn = normalizeWid(info?.phoneNumber || info?.pn || info?.contact?.phoneNumber || info?.contact?.pn, "c.us");
    const out = [];
    pushWid(out, lid, true);
    pushWid(out, direct, !lid && String(direct || "").endsWith("@lid"));
    pushWid(out, pn);
    return out;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function pushWid(list, wid, prefer = false) {
    if (!wid || list.includes(wid)) return;
    if (prefer) list.unshift(wid);
    else list.push(wid);
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
    const candidates = [phoneWid, number];
    const resolvers = [
      ["queryWidExists", window.WPP.contact?.queryWidExists],
      ["queryExists", window.WPP.contact?.queryExists],
    ];

    for (const candidate of candidates) {
      for (const [name, resolver] of resolvers) {
        if (typeof resolver !== "function") continue;
        try {
          const check = await resolver(candidate);
          if (!check) continue;
          const wids = pickWids(check);
          if (wids.length) {
            console.info("[CRM wa-bridge] contato resolvido", { via: name, candidate, wids });
            return wids;
          }
        } catch (e) {
          console.warn(`[CRM wa-bridge] ${name} falhou`, candidate, e);
        }
      }
    }

    throw new Error(`Contato não encontrado no WhatsApp: ${number}`);
  }

  function errorMessage(error) {
    return String(error?.message || error || "erro desconhecido");
  }

  async function sendSilently(number, text) {
    const wids = await resolveWid(number);
    let lastError = null;

    for (const wid of wids) {
      try {
        console.info("[CRM wa-bridge] enviando", wid);
        return await window.WPP.chat.sendTextMessage(wid, text, { waitForAck: true, createChat: true, delay: 250 });
      } catch (e) {
        lastError = e;
        console.warn("[CRM wa-bridge] sendTextMessage falhou", wid, e);
      }
    }

    throw new Error(`Envio silencioso falhou usando queryWidExists/queryExists. Último erro: ${errorMessage(lastError)}`);
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
