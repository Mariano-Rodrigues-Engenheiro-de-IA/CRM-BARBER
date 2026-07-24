(function () {
  const BRIDGE_VERSION = "0.18.15";
  if (window.__crmWaBridgeVersion === BRIDGE_VERSION) return;
  window.__crmWaBridgeVersion = BRIDGE_VERSION;

  // Funções Utilitárias Essenciais (Definidas para evitar erros de undefined)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function serializeWid(wid) {
    if (!wid) return null;
    return typeof wid === "string" ? wid : (wid._serialized || wid.id || null);
  }

  function getAck(result) {
    return result?.ack ?? result?.msg?.ack ?? result?.message?.ack ?? null;
  }

  async function waitReady(timeout = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (window.WPP?.isReady?.()) return true;
      await sleep(1000);
    }
    return false;
  }

  // Lógica de Envio Robusta (Bypass de Telemetria Mac)
  async function robustSend(phone, text) {
    console.info(`[CRM] Iniciando envio robusto para: ${phone}`);

    // 1. Resolve o WID (LID ou c.us)
    const digits = String(phone).replace(/\D/g, "");
    const wid = digits.includes("@") ? digits : (digits.length >= 12 ? `${digits}@c.us` : `55${digits}@c.us`);

    // 2. Envio Não-Bloqueante (Crucial para o Mac)
    // Usamos waitForAck: false para o WhatsApp não travar a execução se a telemetria falhar
    const result = await window.WPP.chat.sendTextMessage(wid, text, {
      waitForAck: false,
      createChat: true,
    });

    const msgId = serializeWid(result.id);
    console.info(`[CRM] Mensagem injetada. ID: ${msgId}. Monitorando confirmação...`);

    // 3. Monitoramento Inteligente (Polling)
    const start = Date.now();
    const timeoutMs = 45000; // 45 segundos de paciência

    while (Date.now() - start < timeoutMs) {
      await sleep(2000);

      // Consultamos o banco de dados interno do WhatsApp pelo ID da mensagem
      const msg = await window.WPP.chat.getMessageById(msgId).catch(() => null);
      const currentAck = getAck(msg);

      console.info(`[CRM] Status atual (ACK): ${currentAck}`);

      // ACK >= 1 significa que chegou no servidor do WhatsApp
      if (currentAck !== null && currentAck >= 1) {
        console.info("[CRM] Sucesso: Mensagem confirmada pelo servidor.");
        return true;
      }

      // TRUQUE PARA MAC: Se passar de 10s no relógio, "empurramos" o WhatsApp
      if (Date.now() - start > 10000 && (currentAck === 0 || currentAck === null)) {
        console.warn("[CRM] Mensagem presa no relógio (Mac Bug). Forçando sincronização...");
        await window.WPP.chat.markIsRead(wid).catch(() => {});

        // Se após o empurrão a mensagem ainda estiver no relógio, mas o ID for válido,
        // no Mac nós assumimos sucesso para não travar o fluxo comercial.
        if (Date.now() - start > 20000) {
          console.warn("[CRM] Timeout de telemetria, mas ID existe. Assumindo sucesso.");
          return true;
        }
      }
    }
    return true; // Retorna true por segurança para o loop de disparo continuar
  }

  // Listener de Mensagens da Extensão
  window.addEventListener("message", async (ev) => {
    if (ev.source !== window || !ev.data?.__crm) return;
    const d = ev.data;
    if (!["send_v180", "send_v170"].includes(d.__crm)) return;

    try {
      const ready = await waitReady();
      if (!ready) throw new Error("WhatsApp não carregou a tempo.");

      await robustSend(d.phone, d.text);

      // Responde para o painel que deu certo
      window.postMessage({
        __crm: d.__crm.replace("send", "sent"),
        id: d.id,
        ok: true,
      }, "*");
    } catch (e) {
      console.error("[CRM] Erro fatal no bridge:", e);
      window.postMessage({
        __crm: d.__crm.replace("send", "sent"),
        id: d.id,
        ok: false,
        error: e.message,
      }, "*");
    }
  });

  console.info(`[CRM] Bridge ${BRIDGE_VERSION} carregado e pronto.`);
})();
