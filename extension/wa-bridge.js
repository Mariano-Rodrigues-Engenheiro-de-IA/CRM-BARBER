// wa-bridge.js — roda no MAIN world do WhatsApp Web, ao lado do wa-js.
// Recebe pedidos de envio do content script (ISOLATED) via window.postMessage
// e usa WPP.chat.sendTextMessage para enviar SEM abrir a conversa.
// Referência: https://wppconnect.io/wa-js/

(function () {
  const TAG = "[CRM wa-bridge]";
  if (window.__crmWaBridgeVersion === "0.8.0") {
    window.postMessage({ __crm: "bridge_ready_v8", ok: !!window.WPP, hasWPP: !!window.WPP, isReady: !!window.WPP, version: "0.8.0" }, "*");
    return;
  }
  window.__crmWaBridgeVersion = "0.8.0";
  let readyLogged = false;

  function ready() {
    return !!(window.WPP && (window.WPP.isReady === true || window.WPP.isReady?.() === true));
  }

  function status(extra = {}) {
    return {
      __crm: "bridge_pong",
      ok: ready(),
      hasWPP: !!window.WPP,
      isReady: ready(),
      version: "0.8.0",
      ...extra,
    };
  }

  async function waitReady(timeout = 60000) {
    if (ready()) return true;
    // WPP.webpack.onFullReady é o hook oficial
    return await new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), timeout);
      if (window.WPP?.webpack?.onFullReady) {
        window.WPP.webpack.onFullReady.push(() => { clearTimeout(t); resolve(true); });
      } else {
        const iv = setInterval(() => {
          if (ready()) { clearTimeout(t); clearInterval(iv); resolve(true); }
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
      if (!ok) throw new Error("WPP não ficou pronto");
      if (!readyLogged) { console.info(TAG, "WPP pronto — envios silenciosos ativos"); readyLogged = true; }
      const chatId = await resolveChatId(phone);
      await window.WPP.chat.sendTextMessage(chatId, text, { waitForAck: true });
      window.postMessage({ __crm: "sent", id, ok: true }, "*");
    } catch (e) {
      console.warn(TAG, "erro no envio", e);
      window.postMessage({ __crm: "sent", id, ok: false, error: String(e?.message || e) }, "*");
    }
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || !d.__crm) return;
    if (d.__crm === "bridge_ping_v8") {
      window.postMessage(status({ id: d.id }), "*");
      return;
    }
    if (d.__crm !== "send_v8") return;
    sendOne(d.id, String(d.phone || ""), String(d.text || ""));
  });

  // Sinaliza prontidão pro isolated world
  waitReady().then((ok) => {
    window.postMessage({ __crm: "bridge_ready_v8", ok, hasWPP: !!window.WPP, isReady: ready(), version: "0.8.0" }, "*");
  });
})();
