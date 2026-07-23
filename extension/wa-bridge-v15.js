// wa-bridge — MAIN world. Recebe {__crm:"send", id, phone, text} e envia silenciosamente via WPP (wa-js).
// WhatsApp Web atual exige LID em alguns perfis. Não usamos fallback visível.
(function () {
  const BRIDGE_VERSION = "0.18.10";
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

  async function resolveFromPhoneWid(phoneWid) {
    const pnWid = createWid(phoneWid);

    const cached = getCachedLid(phoneWid);
    if (cached) {
      console.info("[CRM wa-bridge] LID resolvido via cache", { phoneWid, wid: cached });
      return cached;
    }

    const internal = await tryToUserLid(phoneWid);
    if (internal) return internal;

    if (typeof window.WPP.contact?.getPnLidEntry === "function") {
      for (const candidate of [pnWid, phoneWid]) {
        try {
          const entry = await window.WPP.contact.getPnLidEntry(candidate);
          const wid = pickLid(entry);
          if (wid) {
            console.info("[CRM wa-bridge] LID resolvido via getPnLidEntry", { phoneWid, wid, entry });
            return wid;
          }
        } catch (e) {
          console.warn("[CRM wa-bridge] getPnLidEntry falhou", phoneWid, e);
        }
      }
    }

    const resolvers = [
      ["queryWidExists", window.WPP.contact?.queryWidExists],
      ["queryExists", window.WPP.contact?.queryExists],
    ];

    for (const [name, resolver] of resolvers) {
      if (typeof resolver !== "function") continue;
      for (const candidate of [pnWid, phoneWid]) {
        try {
          const check = await resolver(candidate);
          const wid = pickLid(check);
          if (wid) {
            console.info("[CRM wa-bridge] LID resolvido", { via: name, candidate: phoneWid, wid, check });
            return wid;
          }

          const checkedPhone = pickPhoneWid(check);
          if (checkedPhone && checkedPhone !== phoneWid) {
            await sleep(200);
            const fromCheckedPhone = getCachedLid(checkedPhone);
            if (fromCheckedPhone) {
              console.info("[CRM wa-bridge] LID resolvido via PN corrigido", { via: name, phoneWid, checkedPhone, wid: fromCheckedPhone, check });
              return fromCheckedPhone;
            }
            if (typeof window.WPP.contact?.getPnLidEntry === "function") {
              const entry = await window.WPP.contact.getPnLidEntry(createWid(checkedPhone));
              const entryWid = pickLid(entry);
              if (entryWid) {
                console.info("[CRM wa-bridge] LID resolvido via getPnLidEntry do PN corrigido", { via: name, phoneWid, checkedPhone, wid: entryWid, entry });
                return entryWid;
              }
            }
          }

          await sleep(250);
          const afterQuery = getCachedLid(phoneWid);
          if (afterQuery) {
            console.info("[CRM wa-bridge] LID resolvido após query", { via: name, phoneWid, wid: afterQuery, check });
            return afterQuery;
          }
        } catch (e) {
          console.warn(`[CRM wa-bridge] ${name} falhou`, phoneWid, e);
        }
      }
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

    throw new Error(`LID não resolvido para ${number}. Tente abrir/atualizar o WhatsApp Web e disparar novamente; o envio silencioso foi bloqueado para evitar o erro "No LID for user".`);
  }

  function errorMessage(error) {
    return String(error?.message || error || "erro desconhecido");
  }

  async function sendSilently(number, text) {
    const wid = await resolveWid(number);
    try {
      console.info("[CRM wa-bridge] enviando silencioso via LID", wid);
      return await window.WPP.chat.sendTextMessage(wid, text, { waitForAck: true, createChat: true, delay: 250 });
    } catch (e) {
      console.warn("[CRM wa-bridge] sendTextMessage falhou", wid, e);
      throw new Error(`Envio silencioso falhou via ${wid}. Último erro: ${errorMessage(e)}`);
    }
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
