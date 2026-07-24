(function () {
  const BRIDGE_VERSION = "0.18.30";
  if (window.__crmWaBridgeVersion === BRIDGE_VERSION) return;
  window.__crmWaBridgeVersion = BRIDGE_VERSION;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitReady(timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const wpp = window.WPP;
        if (wpp) {
          const ready = typeof wpp.isReady === "function" ? wpp.isReady() : wpp.isReady;
          if (ready) return true;
        }
      } catch {}
      await sleep(300);
    }
    throw new Error("WPP não ficou pronto a tempo");
  }

  function phoneCandidates(phone) {
    const digits = String(phone).replace(/\D/g, "");
    const base = digits.startsWith("55") ? digits : "55" + digits;
    const out = new Set([base]);
    // BR 9º dígito: com 13 dígitos remove o 9; com 12 dígitos adiciona.
    if (base.length === 13) out.add(base.slice(0, 4) + base.slice(5));
    if (base.length === 12) out.add(base.slice(0, 4) + "9" + base.slice(4));
    return [...out];
  }

  // Resolução de LID via queryWidExists (Pro Engine).
  async function resolveTarget(phone) {
    for (const num of phoneCandidates(phone)) {
      const wid = `${num}@c.us`;
      try {
        const check = await window.WPP.contact.queryWidExists(wid);
        if (check) {
          // Prioridade absoluta ao LID quando disponível.
          const lid =
            check.lid ||
            (check.id?.server === "lid" ? check.id._serialized : null) ||
            check.wid?._serialized;
          if (lid) {
            console.info(`[CRM] LID resolvido para ${num}: ${lid}`);
            return lid;
          }
          if (check.id?._serialized) return check.id._serialized;
          return wid;
        }
      } catch (e) {
        console.warn(`[CRM] queryWidExists falhou p/ ${num}:`, e?.message || e);
      }
    }
    // Fallback: usa o próprio número — evita bloquear a fila.
    const digits = String(phone).replace(/\D/g, "");
    const base = digits.startsWith("55") ? digits : "55" + digits;
    return `${base}@c.us`;
  }

  async function sendPro(phone, text) {
    await waitReady();
    const target = await resolveTarget(phone);
    console.info(`[CRM] Alvo final: ${target}`);

    // Ensure Chat — carrega metadados antes do envio.
    try {
      await window.WPP.chat.ensureChat(target);
    } catch (e) {
      console.warn("[CRM] ensureChat falhou (seguindo):", e?.message || e);
    }

    // Envio assíncrono — waitForAck:false contorna telemetria do Mac.
    try {
      await window.WPP.chat.sendTextMessage(target, text, {
        waitForAck: false,
        createChat: true,
      });
      console.info("[CRM] sendTextMessage aceito na fila local");
    } catch (e) {
      console.error("[CRM] sendTextMessage falhou:", e?.message || e);
      // Fallback universal via MsgStore.
      try {
        await window.WPP.whatsapp.MsgStore.addMsgAndSend({
          to: target,
          body: text,
          type: "chat",
        });
        console.info("[CRM] Fallback MsgStore ok");
      } catch (err2) {
        console.error("[CRM] Fallback MsgStore falhou:", err2?.message || err2);
        throw e;
      }
    }

    // Queue push — força processamento da fila de saída.
    await sleep(400);
    try {
      await window.WPP.chat.markIsRead(target);
    } catch {}

    return true;
  }

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window || !ev.data?.__crm) return;
    const d = ev.data;
    if (!["send_v180", "send_v170"].includes(d.__crm)) return;

    const ackType = d.__crm.replace("send", "sent");
    try {
      await sendPro(d.phone, d.text);
      window.postMessage({ __crm: ackType, id: d.id, ok: true }, "*");
    } catch (e) {
      window.postMessage(
        { __crm: ackType, id: d.id, ok: false, error: e?.message || String(e) },
        "*",
      );
    }
  });

  console.info(`[CRM] Bridge ${BRIDGE_VERSION} (Pro Engine) pronto.`);
})();
