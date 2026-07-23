// wa-bridge — MAIN world. Recebe {__crm:"send", id, phone, text} e envia silenciosamente via WPP (wa-js).
// WhatsApp Web atual exige LID em alguns perfis. Não usamos fallback visível.
(function () {
  const BRIDGE_VERSION = "0.18.7";
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
    if (typeof wid.toString === "function") return wid.toString();
    return null;
  }

  function normalizeWid(value, server) {
    const serialized = serializeWid(value);
    if (!serialized) return null;
    if (serialized.includes("@")) return serialized;
    const digits = serialized.replace(/\D/g, "");
    if (!digits) return null;
    return `${digits}@${server}`;
  }

  function pickLid(info) {
    const candidates = [
      info?.lid,
      info?.lidWid,
      info?.contact?.lid,
      info?.contact?.lidWid,
      info?.wid,
      info?.id,
    ];
    for (const candidate of candidates) {
      const wid = normalizeWid(candidate, "lid");
      if (wid && wid.endsWith("@lid")) return wid;
    }
    return null;
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
      return pickLid({ lid: fromCache || fromApiContact });
    } catch (e) {
      console.warn("[CRM wa-bridge] leitura do cache LID falhou", e);
      return null;
    }
  }

  async function resolveWid(number) {
    const phoneWid = `${number}@c.us`;
    const pnWid = createWid(phoneWid);
    const candidates = [pnWid, phoneWid, number];
    const delays = [0, 700, 1400, 2600];

    for (const delay of delays) {
      if (delay) await sleep(delay);

      const cached = getCachedLid(phoneWid);
      if (cached) {
        console.info("[CRM wa-bridge] LID resolvido via cache", { phoneWid, wid: cached });
        return cached;
      }

      if (typeof window.WPP.contact?.getPnLidEntry === "function") {
        try {
          const entry = await window.WPP.contact.getPnLidEntry(pnWid);
          const wid = pickLid(entry);
          if (wid) {
            console.info("[CRM wa-bridge] LID resolvido via getPnLidEntry", { phoneWid, wid, entry });
            return wid;
          }
        } catch (e) {
          console.warn("[CRM wa-bridge] getPnLidEntry falhou", phoneWid, e);
        }
      }

      const resolvers = [
        ["queryExists", window.WPP.contact?.queryExists],
        ["queryWidExists", window.WPP.contact?.queryWidExists],
      ];

      for (const candidate of candidates) {
        for (const [name, resolver] of resolvers) {
          if (typeof resolver !== "function") continue;
          try {
            const check = await resolver(candidate);
            const wid = pickLid(check);
            if (wid) {
              console.info("[CRM wa-bridge] LID resolvido", { via: name, candidate, wid, check });
              return wid;
            }
          } catch (e) {
            console.warn(`[CRM wa-bridge] ${name} falhou`, candidate, e);
          }
        }
      }
    }

    throw new Error(`LID não resolvido para ${number}. O WhatsApp/wa-js não retornou o identificador @lid; envio silencioso bloqueado para evitar o erro "No LID for user".`);
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
