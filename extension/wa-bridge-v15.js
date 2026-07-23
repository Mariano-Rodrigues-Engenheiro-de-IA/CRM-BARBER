// wa-bridge — MAIN world. Recebe {__crm:"send", id, phone, text} e envia silenciosamente via WPP (wa-js).
(function () {
  function normalize(phone) {
    const only = String(phone || "").replace(/\D/g, "");
    return only.startsWith("55") ? only : "55" + only;
  }
  async function waitReady(timeoutMs = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (window.WPP && window.WPP.isReady) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }
  window.addEventListener("message", async (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.__crm !== "send") return;
    try {
      const ready = await waitReady();
      if (!ready) throw new Error("WhatsApp Web ainda não carregou");
      const to = normalize(d.phone);
      await window.WPP.chat.sendTextMessage(`${to}@c.us`, String(d.text || ""), { waitForAck: true });
      window.postMessage({ __crm: "sent", id: d.id, ok: true }, "*");
    } catch (e) {
      window.postMessage({ __crm: "sent", id: d.id, ok: false, error: (e && e.message) || "erro" }, "*");
    }
  });
})();
