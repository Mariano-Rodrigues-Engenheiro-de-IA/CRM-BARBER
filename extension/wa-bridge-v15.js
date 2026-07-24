(function () {
  const BRIDGE_VERSION = "0.18.23";
  if (window.__crmWaBridgeVersion === BRIDGE_VERSION) return;
  window.__crmWaBridgeVersion = BRIDGE_VERSION;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitReady(timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const wpp = window.WPP;
        if (wpp) {
          const ready =
            (typeof wpp.isReady === "function" ? wpp.isReady() : wpp.isReady) ||
            (wpp.conn && (typeof wpp.conn.isAuthenticated === "function"
              ? wpp.conn.isAuthenticated()
              : wpp.conn.isAuthenticated));
          if (ready) return true;
        }
      } catch {}
      await sleep(300);
    }
    return !!window.WPP;
  }

  function digitsOnly(phone) {
    return String(phone || "").replace(/\D/g, "");
  }

  // Gera candidatos BR (com/sem nono dígito). Também aceita não-BR.
  function buildCandidates(phone) {
    const d = digitsOnly(phone);
    if (!d) return [];
    const set = new Set();
    set.add(d);
    // BR: 55 + DDD(2) + numero(8 ou 9)
    if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
      const ddd = d.slice(2, 4);
      const rest = d.slice(4);
      if (rest.length === 9 && rest.startsWith("9")) {
        set.add(`55${ddd}${rest.slice(1)}`); // sem o 9
      } else if (rest.length === 8) {
        set.add(`55${ddd}9${rest}`); // com o 9
      }
    }
    return Array.from(set).map((n) => `${n}@c.us`);
  }

  // Passo 1: garante o chat / sincroniza LID
  async function ensureChat(wid) {
    try {
      if (window.WPP?.chat?.ensureChat) {
        await window.WPP.chat.ensureChat(wid);
        return true;
      }
    } catch (e) {
      console.warn("[CRM] ensureChat falhou:", e?.message || e);
    }
    // fallback: força carregamento de contato
    try {
      await window.WPP?.contact?.getContact?.(wid);
    } catch {}
    return false;
  }

  // Passo 2: injeção assíncrona (não bloqueia por ack)
  async function sendOnce(wid, text) {
    await ensureChat(wid);
    const res = await window.WPP.chat.sendTextMessage(wid, text, {
      waitForAck: false,
      createChat: true,
    });
    // Se conseguimos um id (ou o WPP não lançou), assumimos sucesso.
    return !!res;
  }

  async function robustSend(phone, text) {
    const candidates = buildCandidates(phone);
    if (!candidates.length) throw new Error("Telefone inválido");

    let lastErr = null;
    for (const wid of candidates) {
      try {
        console.info(`[CRM] envio async → ${wid}`);
        const ok = await sendOnce(wid, text);
        if (ok) return true;
      } catch (e) {
        lastErr = e;
        const msg = String(e?.message || e);
        console.warn(`[CRM] falha em ${wid}: ${msg}`);
        // segue para próximo candidato (double-check BR)
      }
    }
    throw lastErr || new Error("Envio falhou em todos os candidatos");
  }

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window || !ev.data?.__crm) return;
    const d = ev.data;
    if (!["send_v180", "send_v170"].includes(d.__crm)) return;

    try {
      await waitReady();
      await robustSend(d.phone, d.text);
      window.postMessage({ __crm: d.__crm.replace("send", "sent"), id: d.id, ok: true }, "*");
    } catch (e) {
      window.postMessage(
        { __crm: d.__crm.replace("send", "sent"), id: d.id, ok: false, error: e?.message || String(e) },
        "*"
      );
    }
  });

  console.info(`[CRM] Bridge ${BRIDGE_VERSION} (Ensure & Async Send) carregado.`);
})();
