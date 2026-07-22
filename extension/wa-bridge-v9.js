// wa-bridge-v9.js — roda no MAIN world do WhatsApp Web, ao lado do wa-js.
// Recebe pedidos de envio do content script (ISOLATED) via window.postMessage
// e usa WPP.chat.sendTextMessage para enviar SEM abrir a conversa.
// Referência: https://wppconnect.io/wa-js/

(function () {
  const TAG = "[CRM wa-bridge]";
  const VERSION = "0.9.0";
  if (window.__crmWaBridgeVersion === VERSION) {
    window.postMessage({ __crm: "bridge_ready_v9", ok: hasSilentApi(), hasWPP: !!window.WPP, version: VERSION }, "*");
    return;
  }
  window.__crmWaBridgeVersion = VERSION;
  let readyLogged = false;

  function hasSilentApi() {
    return !!(
      window.WPP &&
      typeof window.WPP.chat?.sendTextMessage === "function" &&
      typeof window.WPP.contact?.queryExists === "function"
    );
  }

  function status(extra = {}) {
    return {
      __crm: "bridge_pong",
      ok: hasSilentApi(),
      hasWPP: !!window.WPP,
      hasSilentApi: hasSilentApi(),
      version: VERSION,
      ...extra,
    };
  }

  async function waitReady(timeout = 60000) {
    if (hasSilentApi()) return true;
    return await new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), timeout);
      const onFullReady = window.WPP?.webpack?.onFullReady;
      if (Array.isArray(onFullReady)) {
        onFullReady.push(() => {
          if (hasSilentApi()) { clearTimeout(t); resolve(true); }
        });
      } else if (typeof onFullReady === "function") {
        onFullReady(() => {
          if (hasSilentApi()) { clearTimeout(t); resolve(true); }
        });
      } else {
        const iv = setInterval(() => {
          if (hasSilentApi()) { clearTimeout(t); clearInterval(iv); resolve(true); }
        }, 500);
      }
    });
  }

  function phoneCandidates(raw) {
    const digits = String(raw || "").replace(/\D+/g, "");
    const out = [];
    const add = (v) => { if (v && !out.includes(v)) out.push(v); };
    add(digits);
    if (digits.length === 11 && !digits.startsWith("55")) add(`55${digits}`);
    if (digits.length === 10 && !digits.startsWith("55")) {
      add(`55${digits}`);
      add(`55${digits.slice(0, 2)}9${digits.slice(2)}`);
      add(`${digits.slice(0, 2)}9${digits.slice(2)}`);
    }
    if (digits.startsWith("55") && digits.length === 12) {
      add(`55${digits.slice(2, 4)}9${digits.slice(4)}`);
    }
    if (digits.startsWith("55") && digits.length === 13 && digits[4] === "9") {
      add(`55${digits.slice(2, 4)}${digits.slice(5)}`);
    }
    return out;
  }

  async function resolveChatId(phone) {
    const candidates = phoneCandidates(phone);
    for (const candidate of candidates) {
      const check = await window.WPP.contact.queryExists(candidate).catch(() => null);
      if (check?.wid) {
        return check.wid._serialized || `${candidate}@c.us`;
      }
    }
    throw new Error(`Número não tem WhatsApp (${candidates[0] || phone})`);
  }

  async function sendOne(id, phone, text) {
    try {
      const ok = await waitReady();
      if (!ok) throw new Error("API silenciosa do WhatsApp não ficou pronta");
      if (!readyLogged) { console.info(TAG, "WPP pronto — envios silenciosos ativos"); readyLogged = true; }
      const chatId = await resolveChatId(phone);
      await window.WPP.chat.sendTextMessage(chatId, text, { createChat: true, waitForAck: true });
      window.postMessage({ __crm: "sent", id, ok: true }, "*");
    } catch (e) {
      console.warn(TAG, "erro no envio", e);
      window.postMessage({ __crm: "sent", id, ok: false, error: String(e?.message || e) }, "*");
    }
  }

  function digitsFromWid(value) {
    return String(value || "").replace(/@.*/, "").replace(/\D+/g, "");
  }

  function contactName(model, phone) {
    return String(
      model?.name ||
      model?.pushname ||
      model?.shortName ||
      model?.formattedName ||
      model?.verifiedName ||
      model?.displayName ||
      `Contato ${phone.slice(-4)}`
    ).trim();
  }

  function serializeContact(model) {
    const rawId = model?.id?._serialized || model?.id?.toString?.() || model?.wid?._serialized || model?._serialized || model?.phoneNumber;
    const phone = digitsFromWid(rawId || model?.userid || model?.user || model?.phone);
    if (phone.length < 8) return null;
    if (String(rawId || "").includes("@g.us") || model?.isGroup) return null;
    return { name: contactName(model, phone), phone };
  }

  function storeToArray(store) {
    if (!store) return [];
    if (typeof store.getModelsArray === "function") return store.getModelsArray();
    if (typeof store.toArray === "function") return store.toArray();
    if (Array.isArray(store.models)) return store.models;
    if (Array.isArray(store)) return store;
    return [];
  }

  async function readContacts(id) {
    try {
      await waitReady(20000);
      const possibleFns = [
        window.WPP?.contact?.list,
        window.WPP?.contact?.all,
        window.WPP?.contact?.getAll,
        window.WPP?.contact?.getAllContacts,
      ].filter((fn) => typeof fn === "function");
      let models = [];
      for (const fn of possibleFns) {
        try {
          const result = await fn.call(window.WPP.contact);
          models = Array.isArray(result) ? result : storeToArray(result);
          if (models.length) break;
        } catch { /* tenta próximo */ }
      }
      if (!models.length) {
        const stores = [
          window.WPP?.whatsapp?.ContactStore,
          window.WPP?.ContactStore,
          window.Store?.Contact,
          window.Store?.ContactStore,
        ];
        for (const store of stores) {
          models = storeToArray(store);
          if (models.length) break;
        }
      }
      const byPhone = new Map();
      for (const model of models) {
        const contact = serializeContact(model);
        if (contact && !byPhone.has(contact.phone)) byPhone.set(contact.phone, contact);
      }
      window.postMessage({ __crm: "contacts_v9", id, ok: true, contacts: Array.from(byPhone.values()).slice(0, 1000) }, "*");
    } catch (e) {
      window.postMessage({ __crm: "contacts_v9", id, ok: false, error: String(e?.message || e) }, "*");
    }
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || !d.__crm) return;
    if (d.__crm === "bridge_ping_v9") {
      window.postMessage(status({ id: d.id }), "*");
      return;
    }
    if (d.__crm === "contacts_request_v9") {
      readContacts(d.id);
      return;
    }
    if (d.__crm === "send_v9") sendOne(d.id, String(d.phone || ""), String(d.text || ""));
  });

  // Sinaliza prontidão pro isolated world
  waitReady().then((ok) => {
    window.postMessage({ __crm: "bridge_ready_v9", ok, hasWPP: !!window.WPP, hasSilentApi: hasSilentApi(), version: VERSION }, "*");
  });
})();
