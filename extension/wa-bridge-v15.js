// wa-bridge — MAIN world. Recebe {__crm:"send", id, phone, text} e envia silenciosamente via WPP (wa-js).
// Fix "No LID for user": resolve o WID via queryExists antes de enviar (popula o cache LID que o WhatsApp novo exige).
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

  async function resolveWid(number) {
    // queryExists faz o WhatsApp buscar e cachear o LID mapping do número.
    // Sem isso, sendTextMessage joga "No LID for user" nas versões novas do WA Web.
    try {
      const info = await window.WPP.contact.queryExists(number);
      if (info && info.wid) return info.wid;
    } catch (e) {
      console.warn("[CRM wa-bridge] queryExists falhou", e);
    }
    return `${number}@c.us`;
  }

  async function sendWithFallback(number, text) {
    const wid = await resolveWid(number);
    // Pequena pausa: dá tempo do WA popular o LID no store.
    await new Promise((r) => setTimeout(r, 400));
    try {
      return await window.WPP.chat.sendTextMessage(wid, text, { waitForAck: true });
    } catch (e1) {
      const msg = String(e1 && (e1.message || e1)) || "";
      if (!/lid/i.test(msg)) throw e1;
      // Retry: força re-sync do contato e tenta de novo.
      console.warn("[CRM wa-bridge] retry após LID error", msg);
      try { await window.WPP.contact.queryExists(number); } catch {}
      await new Promise((r) => setTimeout(r, 800));
      return await window.WPP.chat.sendTextMessage(wid, text, { waitForAck: true });
    }
  }

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.__crm !== "send") return;
    try {
      const ready = await waitReady();
      if (!ready) throw new Error("WhatsApp Web ainda não carregou");
      const to = normalize(d.phone);
      await sendWithFallback(to, String(d.text || ""));
      window.postMessage({ __crm: "sent", id: d.id, ok: true }, "*");
    } catch (e) {
      window.postMessage({ __crm: "sent", id: d.id, ok: false, error: (e && e.message) || "erro" }, "*");
    }
  });
})();
