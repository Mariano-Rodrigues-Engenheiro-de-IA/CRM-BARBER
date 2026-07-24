(function () {
  const BRIDGE_VERSION = "0.18.22"; // Versão nova para furar o cache
  if (window.__crmWaBridgeVersion === BRIDGE_VERSION) return;
  window.__crmWaBridgeVersion = BRIDGE_VERSION;

  const serialize = (w) => (typeof w === "string" ? w : (w?._serialized || w?.id?._serialized || w?.id || null));

  // RESOLVEDOR "BRUTO" DE LID
  async function resolveLid(phone) {
    const digits = String(phone).replace(/\D/g, "");
    const wid = digits.includes("@") ? digits : (digits.startsWith("55") ? `${digits}@c.us` : `55${digits}@c.us`);

    console.log(`[CRM] Tentando resolver LID para ${wid}...`);

    try {
      // Técnica 1: Força o WhatsApp a baixar o contato para o cache local
      await window.WPP.contact.getContact(wid).catch(() => {});

      // Técnica 2: Usa o conversor oficial (toUserLid)
      const toUserLid = window.WPP?.whatsapp?.toUserLid || window.WPP?.whatsapp?.Functions?.toUserLid;
      if (typeof toUserLid === "function") {
        const lid = await toUserLid(wid).catch(() => null);
        if (lid) {
          const s = serialize(lid);
          console.log(`[CRM] LID encontrado via toUserLid: ${s}`);
          return s;
        }
      }

      // Técnica 3: Busca no Store interno
      const contact = window.WPP?.whatsapp?.ContactStore?.get(wid);
      if (contact?.lid) {
        const s = serialize(contact.lid);
        console.log(`[CRM] LID encontrado no Store: ${s}`);
        return s;
      }

      // Técnica 4: Consulta de rede (último recurso)
      const check = await window.WPP.contact.queryWidExists(wid).catch(() => null);
      const cLid = check?.lid || check?.id?.lid || (check?.id?.server === "lid" ? check.id._serialized : null);
      if (cLid) return cLid;
    } catch (e) {
      console.warn("[CRM] Erro na busca de LID:", e.message);
    }

    return wid; // Se nada funcionar, retorna o original
  }

  async function robustSend(phone, text) {
    const target = await resolveLid(phone);
    console.info(`[CRM] Alvo final: ${target}`);

    // TRUQUE DE MESTRE: No Mac, se o WPP.chat.sendTextMessage falhar por LID,
    // nós usamos o método interno de baixo nível que pula essa verificação.
    try {
      console.log("[CRM] Enviando...");
      await window.WPP.chat.sendTextMessage(target, text, {
        waitForAck: false,
        createChat: true,
      });
      return true;
    } catch (e) {
      if (String(e?.message || "").includes("LID")) {
        console.warn("[CRM] Fallback de emergência ativado...");
        // Tenta enviar usando o formatador de chat bruto
        const chat = await window.WPP.chat.get(target);
        return await chat.sendMessage(text).then(() => true).catch(() => false);
      }
      throw e;
    }
  }

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window || !ev.data?.__crm) return;
    const d = ev.data;
    if (!["send_v180", "send_v170"].includes(d.__crm)) return;

    try {
      await robustSend(d.phone, d.text);
      window.postMessage({ __crm: d.__crm.replace("send", "sent"), id: d.id, ok: true }, "*");
    } catch (e) {
      window.postMessage({ __crm: d.__crm.replace("send", "sent"), id: d.id, ok: false, error: e.message }, "*");
    }
  });

  console.info(`[CRM] Bridge ${BRIDGE_VERSION} (ULTRA FIX) carregado.`);
})();
