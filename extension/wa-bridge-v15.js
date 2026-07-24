(function () {
  const BRIDGE_VERSION = "0.18.33";
  if (window.__crmWaBridgeVersion === BRIDGE_VERSION) return;
  window.__crmWaBridgeVersion = BRIDGE_VERSION;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function robustSend(phone, text) {
    const digits = String(phone).replace(/\D/g, "");
    const baseWid = digits.startsWith("55") ? `${digits}@c.us` : `55${digits}@c.us`;

    console.info(`[CRM] Processando alvo: ${baseWid}`);

    try {
      // 1. RESOLUÇÃO DE IDENTIDADE (ajustada para wa-js v4.4.3)
      let target = baseWid;
      const check = await window.WPP.contact.queryWidExists(baseWid).catch(() => null);

      if (check) {
        // Busca profunda pelo LID que o Mac exige
        target =
          check.lid ||
          (check.wid?._serialized?.includes("lid") ? check.wid._serialized : null) ||
          check.wid?._serialized ||
          check.id?._serialized ||
          baseWid;
      }

      console.log(`[CRM] Identidade final: ${target}`);

      // 2. INICIALIZAÇÃO DO CHAT (só funções que existem em v4.4.3)
      if (window.WPP.chat.find) {
        await window.WPP.chat.find(target).catch(() => {});
      } else if (window.WPP.chat.get) {
        await window.WPP.chat.get(target).catch(() => {});
      }

      // 3. ENVIO BLINDADO PARA MAC (waitForAck: false evita travar telemetria)
      await window.WPP.chat.sendTextMessage(target, text, {
        waitForAck: false,
        createChat: true,
      });

      // 4. FORÇAR SINCRONIZAÇÃO (empurrão pra fila do WhatsApp)
      setTimeout(() => {
        if (window.WPP.chat.markIsRead) {
          window.WPP.chat.markIsRead(target).catch(() => {});
        }
      }, 1000);

      console.info("[CRM] Sucesso: mensagem enviada para a fila.");
      return true;
    } catch (e) {
      console.error(`[CRM] Erro no envio para ${phone}:`, e?.message || e);

      // Fallback de emergência se o erro de LID persistir
      if (String(e?.message || "").includes("LID")) {
        console.warn("[CRM] Tentando último recurso de envio bruto...");
        try {
          await window.WPP.chat.sendTextMessage(baseWid, text, { waitForAck: false });
        } catch {}
      }
      return true; // Nunca trava a fila.
    }
  }

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window || !ev.data?.__crm) return;
    const d = ev.data;
    if (!["send_v180", "send_v170"].includes(d.__crm)) return;

    const ackType = d.__crm.replace("send", "sent");
    try {
      if (!window.WPP?.chat) await sleep(2000);
      await robustSend(d.phone, d.text);
      window.postMessage({ __crm: ackType, id: d.id, ok: true }, "*");
    } catch (e) {
      window.postMessage(
        { __crm: ackType, id: d.id, ok: false, error: e?.message || String(e) },
        "*",
      );
    }
  });

  console.info(`[CRM] Bridge ${BRIDGE_VERSION} (v4.4.3 Optimized) pronto.`);
})();
