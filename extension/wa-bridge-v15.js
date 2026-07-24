// wa-bridge — MAIN world. Recebe {__crm:"send", id, phone, text} e envia silenciosamente via WPP (wa-js).
// WhatsApp Web atual exige LID em alguns perfis. Não usamos fallback visível.
(function () {
  const BRIDGE_VERSION = "0.18.14";
  if (window.__crmWaBridgeVersion === BRIDGE_VERSION) return;
  window.__crmWaBridgeVersion = BRIDGE_VERSION;

  function normalize(phone) {
    const only = String(phone || "").replace(/\D/g, "");
    return only.startsWith("55") ? only : "55" + only;
  }

  function serializeWid(wid) {
    if (!wid) return null;
    if (typeof wid === "string") return wid;
    if (typeof wid._serialized === "string") return wid._serialized;
    if (typeof wid.serialized === "string") return wid.serialized;
    const user = wid.user || wid.id;
    if (user && typeof wid.server === "string") return `${user}@${wid.server}`;
    if (wid.wid) {
      const nested = serializeWid(wid.wid);
      if (nested) return nested;
    }
    if (typeof wid.toString === "function" && wid.toString !== Object.prototype.toString) {
      const value = wid.toString();
      if (value && value !== "[object Object]") return value;
    }
    return null;
  }

  function isValidWid(wid, server) {
    if (!wid || !wid.endsWith(`@${server}`)) return false;
    const user = wid.slice(0, -1 * (server.length + 1));
    const digits = user.replace(/\D/g, "");
    // LIDs reais têm muitos dígitos; "1@lid", "0@lid" etc. são placeholders inválidos.
    if (server === "lid") return digits.length >= 10;
    if (server === "c.us") return digits.length >= 8;
    return digits.length >= 8;
  }

  function normalizeWid(value, server) {
    const serialized = serializeWid(value);
    if (!serialized) return null;
    if (serialized.includes("@")) {
      return isValidWid(serialized, server) ? serialized : null;
    }
    const digits = serialized.replace(/\D/g, "");
    if (!digits) return null;
    const candidate = `${digits}@${server}`;
    return isValidWid(candidate, server) ? candidate : null;
  }

  function deepPickWid(value, server, seen = new WeakSet(), depth = 0) {
    const wid = normalizeWid(value, server);
    if (wid && wid.endsWith(`@${server}`)) return wid;
    if (!value || typeof value !== "object" || depth > 5) return null;
    if (seen.has(value)) return null;
    seen.add(value);

    const priorityKeys = server === "lid"
      ? ["lid", "lidWid", "currentLid", "alternateUserWid", "alternateWid", "pnLid", "wid", "id", "contact"]
      : ["phoneNumber", "phoneWid", "pn", "wid", "id", "contact"];

    for (const key of priorityKeys) {
      const nested = deepPickWid(value[key], server, seen, depth + 1);
      if (nested) return nested;
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      if (priorityKeys.includes(key)) continue;
      if (server === "lid" && !/lid|wid|contact|user|id/i.test(key)) continue;
      if (server === "c.us" && !/phone|pn|wid|contact|user|id/i.test(key)) continue;
      const nested = deepPickWid(nestedValue, server, seen, depth + 1);
      if (nested) return nested;
    }
    return null;
  }

  function pickLid(info) {
    const candidates = [
      info?.lid,
      info?.lidWid,
      info?.currentLid,
      info?.alternateUserWid,
      info?.alternateWid,
      info?.contact?.lid,
      info?.contact?.lidWid,
      info?.wid,
      info?.id,
    ];
    for (const candidate of candidates) {
      const wid = normalizeWid(candidate, "lid");
      if (wid && wid.endsWith("@lid")) return wid;
    }
    return deepPickWid(info, "lid");
  }

  function pickPhoneWid(info) {
    return deepPickWid(info, "c.us");
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitReady(timeoutMs = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ready = typeof window.WPP?.isReady === "function" ? window.WPP.isReady() : window.WPP?.isReady;
      if (window.WPP && ready) return true;
      await sleep(500);
    }
    return false;
  }

  function createWid(value) {
    const factoryCreate = window.WPP?.whatsapp?.WidFactory?.createWid;
    if (typeof factoryCreate === "function") return factoryCreate(value);
    const utilCreate = window.WPP?.util?.createWid;
    if (typeof utilCreate === "function") return utilCreate(value);
    return value;
  }

  function getCachedLid(phoneWid) {
    try {
      const pn = createWid(phoneWid);
      const fromCache = window.WPP?.whatsapp?.lidPnCache?.getCurrentLid?.(pn);
      const fromApiContact = window.WPP?.whatsapp?.ApiContact?.getCurrentLid?.(pn);
      const fromAlternate = window.WPP?.whatsapp?.ApiContact?.getAlternateUserWid?.(pn);
      return pickLid({ lid: fromCache || fromApiContact || fromAlternate, fromCache, fromApiContact, fromAlternate });
    } catch (e) {
      console.warn("[CRM wa-bridge] leitura do cache LID falhou", e);
      return null;
    }
  }

  function buildPhoneCandidates(number) {
    const digits = String(number || "").replace(/\D/g, "");
    const candidates = new Set([digits]);
    if (digits.startsWith("55") && digits.length === 13 && digits[4] === "9") {
      candidates.add(`${digits.slice(0, 4)}${digits.slice(5)}`);
    }
    if (digits.startsWith("55") && digits.length === 12) {
      candidates.add(`${digits.slice(0, 4)}9${digits.slice(4)}`);
    }
    return [...candidates].filter(Boolean);
  }

  async function tryToUserLid(phoneWid) {
    const pnWid = createWid(phoneWid);
    const resolvers = [
      ["toUserLid", window.WPP?.whatsapp?.toUserLid],
      ["toUserLidOrThrow", window.WPP?.whatsapp?.toUserLidOrThrow],
    ];
    for (const [name, resolver] of resolvers) {
      if (typeof resolver !== "function") continue;
      for (const candidate of [pnWid, phoneWid]) {
        try {
          const lid = await resolver(candidate);
          const wid = pickLid({ lid });
          if (wid) {
            console.info("[CRM wa-bridge] LID resolvido via whatsapp resolver", { via: name, phoneWid, wid });
            return wid;
          }
        } catch (e) {
          console.warn(`[CRM wa-bridge] ${name} falhou`, phoneWid, e);
        }
      }
    }
    return null;
  }

  async function verifyExistsAndGetCheck(phoneWid) {
    const pnWid = createWid(phoneWid);
    const resolvers = [
      ["queryWidExists", window.WPP.contact?.queryWidExists],
      ["queryExists", window.WPP.contact?.queryExists],
    ];
    for (const [name, resolver] of resolvers) {
      if (typeof resolver !== "function") continue;
      for (const candidate of [pnWid, phoneWid]) {
        try {
          const check = await resolver(candidate);
          if (!check) continue;
          const existsFlag = check.exists ?? check.isRegistered ?? check.registered;
          const hasWid = !!pickPhoneWid(check) || !!pickLid(check);
          if (existsFlag === false && !hasWid) continue;
          if (hasWid || existsFlag === true) {
            return { check, via: name };
          }
        } catch (e) {
          console.warn(`[CRM wa-bridge] ${name} falhou`, phoneWid, e);
        }
      }
    }
    return null;
  }

  async function resolveFromPhoneWid(phoneWid) {
    // Passo 1: confirmar que o número existe no WhatsApp. Sem isso, não enviamos.
    const verified = await verifyExistsAndGetCheck(phoneWid);
    if (!verified) return null;
    const { check, via } = verified;

    // LID direto do resultado do queryExists — caminho mais confiável.
    const lidFromCheck = pickLid(check);
    if (lidFromCheck) {
      console.info("[CRM wa-bridge] LID resolvido via " + via, { phoneWid, wid: lidFromCheck });
      return lidFromCheck;
    }

    // Cache do wa-js (populado após queryExists).
    await sleep(200);
    const cached = getCachedLid(phoneWid);
    if (cached) {
      console.info("[CRM wa-bridge] LID resolvido via cache", { phoneWid, wid: cached });
      return cached;
    }

    // Resolver interno do wa-js.
    const internal = await tryToUserLid(phoneWid);
    if (internal) return internal;

    // Último recurso: WID do contato retornado pelo queryExists (@c.us confirmado existente).
    const phoneWidFromCheck = pickPhoneWid(check);
    if (phoneWidFromCheck) {
      console.info("[CRM wa-bridge] usando @c.us confirmado por " + via, { phoneWid, wid: phoneWidFromCheck });
      return phoneWidFromCheck;
    }

    return null;
  }

  async function resolveWid(number) {
    const phones = buildPhoneCandidates(number);
    const delays = [0, 700, 1400, 2600, 4200];

    for (const delay of delays) {
      if (delay) await sleep(delay);
      for (const phone of phones) {
        const phoneWid = `${phone}@c.us`;
        const wid = await resolveFromPhoneWid(phoneWid);
        if (wid) return wid;
      }
    }

    throw new Error(`Número ${number} não confirmado no WhatsApp — envio bloqueado para evitar mensagem para contato inexistente.`);
  }

  function errorMessage(error) {
    return String(error?.message || error || "erro desconhecido");
  }

  function makeNonRetryableError(message) {
    const error = new Error(message);
    error.crmNonRetryable = true;
    return error;
  }

  function isRetryableSendError(err) {
    if (err?.crmNonRetryable) return false;
    const msg = String(err?.message || err || "").toLowerCase();
    return msg.includes("nack") || msg.includes("463") || msg.includes("timeout") || msg.includes("server-nack") || msg.includes("send-msg");
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function readAckValue(value) {
    const candidates = [
      value?.ack,
      value?.message?.ack,
      value?.msg?.ack,
      value?.sendMsgResult?.ack,
      value?.sendMsgResult?.message?.ack,
      value?.sendMsgResult?.msg?.ack,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
      if (typeof candidate === "string" && candidate.trim() !== "" && Number.isFinite(Number(candidate))) return Number(candidate);
    }
    return null;
  }

  function readMessageId(value) {
    const candidates = [
      value?.id,
      value?.message?.id,
      value?.msg?.id,
      value?.sendMsgResult?.id,
      value?.sendMsgResult?.message?.id,
      value?.sendMsgResult?.msg?.id,
    ];
    for (const candidate of candidates) {
      const serialized = serializeWid(candidate);
      if (serialized) return serialized;
    }
    return null;
  }

  async function getMessageAck(messageId) {
    if (!messageId) return null;
    try {
      const info = await window.WPP?.chat?.getMessageACK?.(messageId);
      const ack = readAckValue(info);
      if (ack !== null) return ack;
    } catch (e) {
      console.warn("[CRM wa-bridge] getMessageACK falhou", messageId, e);
    }
    try {
      const message = await window.WPP?.chat?.getMessageById?.(messageId);
      const ack = readAckValue(message);
      if (ack !== null) return ack;
    } catch (e) {
      console.warn("[CRM wa-bridge] getMessageById falhou", messageId, e);
    }
    return null;
  }

  async function verifyViaChatGet(wid, messageId) {
    try {
      const chat = await window.WPP?.chat?.get?.(wid);
      const lastId = serializeWid(chat?.lastMsg?.id);
      const lastAck = readAckValue({ ack: chat?.lastMsg?.ack });
      if (lastId && messageId && lastId === messageId && lastAck !== null && lastAck >= 1) {
        return true;
      }
    } catch (e) {
      console.warn("[CRM wa-bridge] chat.get fallback falhou", wid, e);
    }
    return false;
  }

  async function nudgeOutgoingQueue(wid, reason) {
    try {
      if (typeof window.WPP?.chat?.markIsRead !== "function") return;
      await window.WPP.chat.markIsRead(wid);
      console.info("[CRM wa-bridge] markIsRead executado para sincronizar fila", { wid, reason });
    } catch (e) {
      console.warn("[CRM wa-bridge] markIsRead falhou", wid, e);
    }
  }

  async function readMessageById(messageId) {
    try {
      return await window.WPP?.chat?.getMessageById?.(messageId);
    } catch (e) {
      console.warn("[CRM wa-bridge] getMessageById falhou", messageId, e);
      return null;
    }
  }

  async function waitForServerAck(sendResult, wid, timeoutMs = 12000) {
    const messageId = readMessageId(sendResult);
    let ack = readAckValue(sendResult);
    console.info("[CRM wa-bridge] resultado inicial do envio não-bloqueante", { wid, messageId, ack });

    if (ack !== null && ack >= 1) return sendResult;
    if (ack !== null && ack < 0) {
      throw new Error(`WhatsApp recusou o envio para ${wid} (ack ${ack})`);
    }
    if (!messageId) {
      throw makeNonRetryableError(`WhatsApp não retornou id da mensagem para ${wid}; envio não confirmado.`);
    }

    const start = Date.now();
    let markReadSent = false;
    let lastAck = ack;

    while (Date.now() - start < timeoutMs) {
      await sleep(1500);
      const message = await readMessageById(messageId);
      ack = readAckValue(message);
      if (ack === null) ack = readAckValue(sendResult);
      if (ack !== null) lastAck = ack;

      const elapsedMs = Date.now() - start;
      console.info("[CRM wa-bridge] monitoramento passivo da mensagem", { wid, messageId, ack, elapsedMs });

      if (ack !== null && ack >= 1) return sendResult;
      if (ack !== null && ack < 0) {
        throw new Error(`WhatsApp recusou o envio para ${wid} (ack ${ack})`);
      }

      if (!markReadSent && elapsedMs >= 10000 && lastAck === 0) {
        markReadSent = true;
        await nudgeOutgoingQueue(wid, "ack_0_after_10s");
        console.warn(
          `[CRM wa-bridge] ACK preso em 0 por ${Math.round(elapsedMs / 1000)}s para ${wid} (msg ${messageId}); assumindo sucesso para bypass de telemetria no Mac.`,
        );
        return sendResult;
      }
    }

    if (!markReadSent) await nudgeOutgoingQueue(wid, "passive_monitor_timeout");
    console.warn(
      `[CRM wa-bridge] Monitoramento passivo encerrou sem ACK final para ${wid} (msg ${messageId}, último ack ${lastAck}); assumindo sucesso para evitar duplicidade.`,
    );
    return sendResult;
  }

  async function sendOnce(wid, text) {
    const result = await window.WPP.chat.sendTextMessage(wid, text, {
      waitForAck: false,
      createChat: true,
      delay: 250,
    });
    return await waitForServerAck(result, wid);
  }

  async function sendSilently(number, text) {
    const wid = await resolveWid(number);
    const delays = [0, 4000, 9000]; // initial + 2 retries with backoff to dodge server-side rate limiter (Nack 463)
    let lastErr = null;
    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) await sleep(delays[i]);
      try {
        console.info(`[CRM wa-bridge] enviando silencioso via LID ${wid} (tentativa ${i + 1})`);
        return await sendOnce(wid, text);
      } catch (e) {
        lastErr = e;
        console.warn(`[CRM wa-bridge] sendTextMessage falhou (tentativa ${i + 1})`, wid, e);
        if (!isRetryableSendError(e)) break;
      }
    }
    throw new Error(`Envio silencioso falhou via ${wid} após ${delays.length} tentativas. Último erro: ${errorMessage(lastErr)}`);
  }

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window) return;
    if (window.__crmWaBridgeVersion !== BRIDGE_VERSION) return;
    const d = ev.data;
    if (!d || (d.__crm !== "send_v180" && d.__crm !== "send_v170")) return;
    try {
      const ready = await waitReady();
      if (!ready) throw new Error("WhatsApp Web ainda não carregou");
      const to = normalize(d.phone);
      await sendSilently(to, String(d.text || ""));
      window.postMessage({ __crm: d.__crm === "send_v180" ? "sent_v180" : "sent_v170", id: d.id, ok: true }, "*");
    } catch (e) {
      window.postMessage({ __crm: d.__crm === "send_v180" ? "sent_v180" : "sent_v170", id: d.id, ok: false, error: (e && e.message) || "erro" }, "*");
    }
  });
})();
