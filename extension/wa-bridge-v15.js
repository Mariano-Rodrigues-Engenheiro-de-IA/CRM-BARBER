// wa-bridge — MAIN world. Recebe {__crm:"send", id, phone, text} e envia silenciosamente via WPP (wa-js).
// WhatsApp Web atual exige resolver PN -> LID antes do envio para novos chats.
(function () {
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

  async function waitReady(timeoutMs = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ready = typeof window.WPP?.isReady === "function" ? window.WPP.isReady() : window.WPP?.isReady;
      if (window.WPP && ready) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  async function resolveWid(number) {
    const phoneWid = `${number}@c.us`;

    // Primeiro tenta a API nova documentada: ela retorna o WID correto e alimenta o cache PN/LID.
    try {
      const queryWidExists = window.WPP.contact?.queryWidExists || window.WPP.whatsapp?.functions?.queryWidExists;
      if (queryWidExists) {
        const info = await queryWidExists(phoneWid, "crm-barber");
        const wid = serializeWid(info?.wid);
        if (wid) return wid;
      }
    } catch (e) {
      console.warn("[CRM wa-bridge] queryWidExists falhou", e);
    }

    // Depois consulta o mapeamento local PN <-> LID. Se existir LID, ele é preferível.
    try {
      const entry = await window.WPP.contact?.getPnLidEntry?.(phoneWid);
      const lid = serializeWid(entry?.lid);
      const pn = serializeWid(entry?.phoneNumber);
      if (lid) return lid;
      if (pn) return pn;
    } catch (e) {
      console.warn("[CRM wa-bridge] getPnLidEntry falhou", e);
    }

    // Compat legado: queryExists antigo também precisa receber @c.us, não só dígitos.
    try {
      const info = await window.WPP.contact?.queryExists?.(phoneWid);
      const wid = serializeWid(info?.wid);
      if (wid) return wid;
    } catch (e) {
      console.warn("[CRM wa-bridge] queryExists falhou", e);
    }

    return phoneWid;
  }

  async function sendWithFallback(number, text) {
    let wid = await resolveWid(number);
    // Pequena pausa: dá tempo do WA popular o LID no store.
    await new Promise((r) => setTimeout(r, 400));
    try {
      return await window.WPP.chat.sendTextMessage(wid, text, { waitForAck: true, createChat: true });
    } catch (e1) {
      const msg = String(e1 && (e1.message || e1)) || "";
      if (!/lid/i.test(msg)) throw e1;
      // Retry: força re-sync do contato e tenta de novo, preferindo @lid quando existir.
      console.warn("[CRM wa-bridge] retry após LID error", msg);
      try { await window.WPP.contact?.queryWidExists?.(`${number}@c.us`, "crm-barber-retry"); } catch {}
      try {
        const entry = await window.WPP.contact?.getPnLidEntry?.(`${number}@c.us`);
        wid = serializeWid(entry?.lid) || serializeWid(entry?.phoneNumber) || wid;
      } catch {}
      await new Promise((r) => setTimeout(r, 800));
      return await window.WPP.chat.sendTextMessage(wid, text, { waitForAck: true, createChat: true });
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
