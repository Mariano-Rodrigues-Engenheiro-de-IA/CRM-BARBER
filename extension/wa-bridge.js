// wa-bridge.js — roda no MAIN world do WhatsApp Web, ao lado do wa-js.
// Recebe pedidos de envio do content script (ISOLATED) via window.postMessage
// e usa WPP.chat.sendTextMessage para enviar SEM abrir a conversa.
// Referência: https://wppconnect.io/wa-js/

(function () {
  const TAG = "[CRM wa-bridge]";
  let readyLogged = false;

  function ready() {
    return !!(window.WPP && window.WPP.isReady);
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

  async function sendOne(id, phone, text) {
    try {
      const ok = await waitReady();
      if (!ok) throw new Error("WPP não ficou pronto");
      if (!readyLogged) { console.info(TAG, "WPP pronto — envios silenciosos ativos"); readyLogged = true; }
      // Verifica se o número tem WhatsApp
      const check = await window.WPP.contact.queryExists(phone).catch(() => null);
      if (!check || !check.wid) throw new Error("Número não tem WhatsApp");
      const chatId = check.wid._serialized || (phone + "@c.us");
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
    if (!d || d.__crm !== "send") return;
    sendOne(d.id, String(d.phone || ""), String(d.text || ""));
  });

  // Sinaliza prontidão pro isolated world
  waitReady().then((ok) => {
    window.postMessage({ __crm: "bridge_ready", ok }, "*");
  });
})();
