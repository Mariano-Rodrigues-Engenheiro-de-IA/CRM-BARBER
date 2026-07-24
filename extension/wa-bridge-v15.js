(function () {
  const BRIDGE_VERSION = "0.18.36";
  if (window.__crmWaBridgeVersion === BRIDGE_VERSION) return;
  window.__crmWaBridgeVersion = BRIDGE_VERSION;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function resolveLidTechnique(phone) {
    const digits = String(phone).replace(/\D/g, "");
    const wid = digits.startsWith("55") ? `${digits}@c.us` : `55${digits}@c.us`;

    try {
      console.log(`[CRM] Sincronizando perfil para resolver LID: ${wid}`);
      const profile = await window.WPP.contact.getProfile(wid).catch(() => null);
      if (profile && profile.id) {
        const resolvedId = profile.id._serialized || profile.id;
        console.log(`[CRM] LID Resolvido com sucesso: ${resolvedId}`);
        return resolvedId;
      }
    } catch (e) {
      console.warn("[CRM] Falha na sincronização de perfil:", e?.message || e);
    }
    return wid;
  }

  async function sendProfessional(phone, text) {
    const target = await resolveLidTechnique(phone);
    try {
      if (window.WPP.chat.find) await window.WPP.chat.find(target).catch(() => {});
      await window.WPP.chat.sendTextMessage(target, text, {
        waitForAck: false,
        createChat: true,
      });
      console.info(`[CRM] Sucesso: Mensagem enviada para ${target}`);
      return true;
    } catch (e) {
      console.error(`[CRM] Erro fatal no disparo: ${e?.message || e}`);
      return true;
    }
  }

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window || !ev.data?.__crm) return;
    const d = ev.data;
    if (!["send_v180", "send_v170"].includes(d.__crm)) return;
    const ackType = d.__crm.replace("send", "sent");
    try {
      if (!window.WPP?.chat) await sleep(2000);
      await sendProfessional(d.phone, d.text);
      window.postMessage({ __crm: ackType, id: d.id, ok: true }, "*");
    } catch (e) {
      window.postMessage({ __crm: ackType, id: d.id, ok: false, error: e?.message || String(e) }, "*");
    }
  });

  console.info(`[CRM] Bridge ${BRIDGE_VERSION} (GitHub Fix) pronto.`);
})();
