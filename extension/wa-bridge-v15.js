(function () {
  const BRIDGE_VERSION = "0.31.0";
  if (window.__crmWaBridgeVersion === BRIDGE_VERSION) return;
  window.__crmWaBridgeVersion = BRIDGE_VERSION;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function normalizePhone(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (!digits) throw new Error("Telefone inválido");
    return digits.startsWith("55") ? digits : `55${digits}`;
  }

  function toWid(phone) {
    return `${normalizePhone(phone)}@c.us`;
  }

  function serialized(value) {
    if (!value) return null;
    if (typeof value === "string") return value;
    return value._serialized ||
      value.serialized ||
      value.id?._serialized ||
      value.wid?._serialized ||
      value.jid?._serialized ||
      value.contact?.id?._serialized ||
      null;
  }

  async function waitForWpp() {
    for (let i = 0; i < 30; i += 1) {
      if (window.WPP?.chat) return;
      await sleep(500);
    }
    throw new Error("WhatsApp ainda não carregou o motor interno. Atualize o WhatsApp Web e tente de novo.");
  }

  async function tryStep(label, fn) {
    try {
      const result = await fn();
      console.info(`[CRM] ${label}: ok`);
      return { ok: true, result };
    } catch (e) {
      console.warn(`[CRM] ${label}: ${e?.message || e}`);
      return { ok: false, error: e?.message || String(e) };
    }
  }

  async function resolveTarget(phone) {
    const wid = toWid(phone);

    // Não usamos mais WPP.contact.getProfile: essa função saiu da build atual
    // do WhatsApp/wa-js e quebrava abrir conversa + respostas rápidas.
    const resolvers = [
      async () => {
        if (typeof window.WPP?.contact?.queryExists !== "function") throw new Error("queryExists indisponível");
        const res = await window.WPP.contact.queryExists(wid);
        return serialized(res) || serialized(res?.wid) || serialized(res?.id);
      },
      async () => {
        if (typeof window.WPP?.contact?.queryWidExists !== "function") throw new Error("queryWidExists indisponível");
        const res = await window.WPP.contact.queryWidExists(wid);
        return serialized(res) || serialized(res?.wid) || serialized(res?.id);
      },
      async () => {
        if (typeof window.WPP?.chat?.get !== "function") throw new Error("chat.get indisponível");
        const chat = await window.WPP.chat.get(wid);
        return serialized(chat) || serialized(chat?.id);
      },
    ];

    for (const resolver of resolvers) {
      const result = await resolver().catch(() => null);
      if (result) return result;
    }
    return wid;
  }

  async function openChat(phone) {
    await waitForWpp();
    const target = await resolveTarget(phone);
    const attempts = [
      ["openChatBottom", () => window.WPP.chat.openChatBottom(target)],
      ["openChatAt", () => window.WPP.chat.openChatAt(target)],
      ["openChat", () => window.WPP.chat.openChat(target)],
    ].filter(([, fn]) => typeof fn === "function");

    let lastError = "Não foi possível abrir a conversa";
    for (const [label, fn] of attempts) {
      const result = await tryStep(label, fn);
      if (result.ok) return target;
      lastError = result.error || lastError;
    }

    window.location.href = `https://web.whatsapp.com/send?phone=${normalizePhone(phone)}`;
    await sleep(1200);
    return target;
  }

  /** chat.get pode ser síncrono nesta build — nunca encadear .catch direto. */
  async function getChatSafe(target) {
    try {
      if (typeof window.WPP?.chat?.get !== "function") return null;
      return await Promise.resolve(window.WPP.chat.get(target));
    } catch {
      return null;
    }
  }

  async function sendTextToTarget(target, text) {
    const chat = await getChatSafe(target);
    const attempts = [
      ["chat.sendMessage", () => {
        if (!chat || typeof chat.sendMessage !== "function") throw new Error("chat.sendMessage indisponível");
        return chat.sendMessage(text);
      }],
      ["sendTextMessage", () => {
        if (typeof window.WPP.chat.sendTextMessage !== "function") throw new Error("sendTextMessage indisponível");
        return window.WPP.chat.sendTextMessage(target, text, { waitForAck: false });
      }],
      ["MsgStore.addMsgAndSend", () => {
        const addMsgAndSend = window.WPP?.whatsapp?.MsgStore?.addMsgAndSend;
        if (typeof addMsgAndSend !== "function") throw new Error("MsgStore.addMsgAndSend indisponível");
        return addMsgAndSend.call(window.WPP.whatsapp.MsgStore, {
          to: target,
          body: text,
          type: "chat",
        });
      }],
    ];

    let lastError = "Motor de envio indisponível";
    for (const [label, fn] of attempts) {
      const result = await tryStep(label, fn);
      if (result.ok) return true;
      lastError = result.error || lastError;
    }
    throw new Error(lastError);
  }

  async function robustSend(phone, text) {
    await waitForWpp();
    const target = await resolveTarget(phone);
    console.log(`[CRM] Alvo resolvido: ${target}. Enviando...`);
    await sendTextToTarget(target, text);
    console.info(`[CRM] Sucesso: mensagem enviada para ${target}`);
    return true;
  }

  function base64ToBlob(base64, mime) {
    const clean = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || "application/octet-stream" });
  }

  /**
   * A mídia chega em base64 do service worker: a página do WhatsApp Web tem
   * CSP restritiva e um fetch direto pro Storage é bloqueado. O fetch aqui
   * fica só como último recurso (mídia servida do mesmo domínio).
   */
  async function resolveMediaBlob(action) {
    if (action.data_base64) return base64ToBlob(action.data_base64, action.mime);
    if (!action.url) throw new Error("Mídia sem arquivo");
    const res = await fetch(action.url);
    if (!res.ok) throw new Error(`Falha ao baixar mídia (HTTP ${res.status})`);
    return res.blob();
  }

  async function sendMediaAction(target, action) {
    const blob = await resolveMediaBlob(action);
    const mime = action.mime || blob.type || "application/octet-stream";
    const file = new File([blob], action.filename || "arquivo", { type: mime });
    const kind = action.type === "audio" ? "audio" : action.type === "video" ? "video" : "image";
    const opts = { type: kind, waitForAck: false };
    if (action.caption) opts.caption = action.caption;
    // PTT (áudio de voz) só é aceito em ogg/opus. Outros formatos vão como
    // áudio comum — forçar isPtt faz o WhatsApp descartar o envio em silêncio.
    if (kind === "audio" && /ogg|opus/i.test(mime)) opts.isPtt = true;

    const attempts = [
      ["sendFileMessage", () => {
        if (typeof window.WPP?.chat?.sendFileMessage !== "function") throw new Error("sendFileMessage indisponível");
        return window.WPP.chat.sendFileMessage(target, file, opts);
      }],
      ["sendFileMessage(document)", () => {
        if (typeof window.WPP?.chat?.sendFileMessage !== "function") throw new Error("sendFileMessage indisponível");
        return window.WPP.chat.sendFileMessage(target, file, { ...opts, type: "document" });
      }],
    ];

    let lastError = "Não foi possível enviar a mídia";
    for (const [label, fn] of attempts) {
      const result = await tryStep(label, fn);
      if (result.ok) return true;
      lastError = result.error || lastError;
    }
    throw new Error(lastError);
  }

  /** Executa uma sequência de ações (texto/mídia) na conversa do contato. */
  async function runActions(phone, openOnly, actions, waId) {
    await waitForWpp();
    // Quando a ação vem de uma conversa aberta, o alvo certo é o próprio id
    // do chat (inclusive @lid): montar telefone a partir do LID não existe.
    const target = waId ? String(waId) : await resolveTarget(phone);
    if (openOnly) {
      await openChat(phone);
      return;
    }
    for (const action of actions || []) {
      if (action.type === "text") {
        if (!action.text) continue;
        if (waId) await sendTextToTarget(target, action.text);
        else await robustSend(phone, action.text);
      } else {
        await sendMediaAction(target, action);
      }
      await sleep(700);
    }
  }

  /** Espera os stores internos terem dados (logo após o load ficam vazios). */
  async function waitForStores() {
    for (let i = 0; i < 40; i += 1) {
      const chats = window.WPP?.whatsapp?.ChatStore?.getModelsArray?.() || [];
      if (chats.length > 0) return chats;
      await sleep(750);
    }
    return window.WPP?.whatsapp?.ChatStore?.getModelsArray?.() || [];
  }

  /**
   * Telefone real da conversa. Conversas novas do WhatsApp usam @lid (id
   * interno) — nesse caso o número precisa ser buscado no ContactStore,
   * senão o CRM mostraria o LID no lugar do telefone.
   */
  function resolvePhoneDigits(chat, waId) {
    const clean = (v) => {
      const d = String(v || "").split("@")[0].replace(/\D/g, "");
      return /^\d{10,15}$/.test(d) ? d : null;
    };
    if (waId.endsWith("@g.us")) return null;
    if (waId.endsWith("@c.us")) return clean(waId);

    const contact = (() => {
      try {
        return chat?.contact || window.WPP?.whatsapp?.ContactStore?.get?.(waId) || null;
      } catch { return null; }
    })();

    const tries = [
      () => contact?.phoneNumber,
      () => contact?.id,
      () => contact?.userid,
      () => contact?.__x_id,
      // Mapeamento LID → telefone (builds novas do WhatsApp).
      () => window.WPP?.whatsapp?.LidUtils?.getPhoneNumber?.(waId),
      () => window.WPP?.whatsapp?.functions?.getPhoneNumber?.(waId),
      () => window.WPP?.whatsapp?.LidStore?.get?.(waId)?.pn,
      () => window.WPP?.whatsapp?.LidPnCacheStore?.get?.(waId)?.pn,
      () => chat?.contact?.displayName,
      () => chat?.formattedTitle,
    ];
    for (const get of tries) {
      let v;
      try { v = get(); } catch { continue; }
      const d = clean(typeof v === "object" ? (v?._serialized ?? v?.user ?? v?.pn ?? "") : v);
      if (d) return d;
    }
    return null;
  }

  /** Nome exibível: passa por todas as fontes antes de desistir. */
  function resolveName(chat, waId) {
    let contact = null;
    try {
      contact = chat?.contact || window.WPP?.whatsapp?.ContactStore?.get?.(waId) || null;
    } catch {}
    const candidates = [
      chat?.formattedTitle,
      chat?.__x_formattedTitle,
      chat?.name,
      contact?.name,
      contact?.verifiedName,
      contact?.pushname,
      contact?.notifyName,
      contact?.formattedName,
      contact?.displayName,
      contact?.formattedUser,
      contact?.shortName,
    ];
    for (const c of candidates) {
      const v = String(c || "").trim();
      if (v && !/^\d{15,}$/.test(v.replace(/\D/g, ""))) return v.slice(0, 160);
    }
    const digits = resolvePhoneDigits(chat, waId || "");
    return digits ? `+${digits}` : null;
  }

  /**
   * Etiquetas reais do WhatsApp. Só aceitamos o que vem do LabelStore com
   * nome de verdade — listas "deduzidas" davam entradas fantasma no CRM que
   * nunca sincronizavam de volta.
   */
  function readLabels() {
    const sources = [
      () => window.WPP?.labels?.getAllLabels?.(),
      () => window.WPP?.labels?.getAll?.(),
      () => window.WPP?.whatsapp?.LabelStore?.getModelsArray?.(),
      () => window.WPP?.whatsapp?.LabelStore?.models,
    ];
    for (const get of sources) {
      let list;
      try {
        list = get();
      } catch {
        continue;
      }
      if (!Array.isArray(list) || list.length === 0) continue;
      const out = [];
      for (const l of list) {
        const id = String(l?.id ?? l?.labelId ?? l?.__x_id ?? "");
        const name = String(l?.name ?? l?.__x_name ?? "").trim();
        if (!id || id === "undefined" || !name) continue;
        out.push({
          id,
          name: name.slice(0, 120),
          color: l?.hexColor ? String(l.hexColor).slice(0, 20) : null,
          count: Number(l?.count ?? l?.labelItemCount ?? l?.__x_count ?? 0) || 0,
        });
      }
      if (out.length) return out;
    }
    return [];
  }


  /**
   * Mapa etiqueta → conversas lido do LabelStore. Em builds recentes o chat
   * não expõe mais `labels`, então essa é a fonte confiável da associação.
   */
  function labelChatMap() {
    const map = new Map();
    const add = (labelId, chatId) => {
      const l = String(labelId || "");
      const c = String(chatId || "");
      if (!l || !c || l === "undefined" || c === "undefined") return;
      if (!map.has(c)) map.set(c, new Set());
      map.get(c).add(l);
    };
    try {
      const models =
        window.WPP?.whatsapp?.LabelStore?.getModelsArray?.() ||
        window.WPP?.whatsapp?.LabelStore?.models ||
        [];
      for (const l of models) {
        const labelId = String(l?.id ?? l?.labelId ?? "");
        const coll = l?.labelItemCollection ?? l?.__x_labelItemCollection;
        const items = coll?.getModelsArray?.() || coll?.models || (Array.isArray(coll) ? coll : []);
        for (const it of items) {
          add(labelId, serialized(it?.parentId) || serialized(it?.id) || it?.parentId);
        }
      }
    } catch (e) {
      console.warn("[CRM] LabelStore indisponível:", e?.message || e);
    }
    try {
      const items =
        window.WPP?.whatsapp?.LabelItemStore?.getModelsArray?.() ||
        window.WPP?.whatsapp?.LabelItemStore?.models ||
        [];
      for (const it of items) {
        add(it?.labelId ?? it?.parentId, serialized(it?.parentId) || it?.parentId);
      }
    } catch {}
    return map;
  }

  /** Etiquetas de uma conversa: também mudou de forma entre builds. */
  function chatLabelIds(chat) {
    const raw = chat?.labels ?? chat?.__x_labels ?? chat?.labelIds ?? [];
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.getModelsArray?.()) ? raw.getModelsArray() : [];
    return arr
      .map((x) => String(typeof x === "object" ? (x?.id ?? x?.labelId ?? "") : x))
      .filter((x) => x && x !== "undefined")
      .slice(0, 50);
  }

  /**
   * Lê etiquetas e conversas direto dos stores do WhatsApp Web.
   * Só leitura — nada é enviado daqui; o content script decide o que faz.
   */
  async function collectWaData() {
    await waitForWpp();
    const chats = await waitForStores();

    let labels = [];
    try {
      labels = readLabels();
    } catch (e) {
      console.warn("[CRM] etiquetas indisponíveis:", e?.message || e);
    }

    const byChat = labelChatMap();
    const contacts = [];
    try {
      const known = new Set(labels.map((l) => l.id));
      for (const chat of chats.slice(0, 1500)) {
        const waId = serialized(chat?.id);
        if (!waId) continue;
        const isGroup = waId.endsWith("@g.us");
        const digits = resolvePhoneDigits(chat, waId);
        const ts = Number(chat?.t ?? chat?.__x_t ?? 0);
        contacts.push({
          wa_id: waId,
          phone: isGroup || !digits ? null : digits,
          name: resolveName(chat, waId),
          is_group: isGroup,
          label_ids: (() => {
            const fromChat = chatLabelIds(chat);
            const fromStore = [...(byChat.get(waId) || [])];
            // Só listas que existem de fato no WhatsApp — ids órfãos criavam
            // listas fantasma no CRM.
            return [...new Set([...fromChat, ...fromStore])]
              .filter((id) => !known.size || known.has(id))
              .slice(0, 50);
          })(),
          last_message_at: ts > 0 ? new Date(ts * 1000).toISOString() : null,
        });
      }
    } catch (e) {
      console.warn("[CRM] conversas indisponíveis:", e?.message || e);
    }



    console.info(`[CRM] coletado: ${labels.length} etiqueta(s), ${contacts.length} conversa(s)`);
    return { labels, contacts };
  }


  window.addEventListener("message", async (ev) => {
    if (ev.source !== window || !ev.data?.__crm) return;
    const d = ev.data;

    if (d.__crm === "collect_v200") {
      try {
        const data = await collectWaData();
        window.postMessage({ __crm: "collect_done_v200", id: d.id, ok: true, data }, "*");
      } catch (e) {
        window.postMessage({ __crm: "collect_done_v200", id: d.id, ok: false, error: e?.message || String(e) }, "*");
      }
      return;
    }

    if (d.__crm === "active_chat_v290") {
      try {
        await waitForWpp();
        const chat =
          (typeof window.WPP?.chat?.getActiveChat === "function" && window.WPP.chat.getActiveChat()) ||
          null;
        if (!chat) throw new Error("Nenhuma conversa aberta");
        const waId = serialized(chat?.id);
        const data = {
          wa_id: waId,
          phone: resolvePhoneDigits(chat, waId || ""),
          name: resolveName(chat, waId || ""),
          is_group: String(waId || "").endsWith("@g.us"),
        };
        window.postMessage({ __crm: "active_chat_done_v290", id: d.id, ok: true, data }, "*");
      } catch (e) {
        window.postMessage({ __crm: "active_chat_done_v290", id: d.id, ok: false, error: e?.message || String(e) }, "*");
      }
      return;
    }

    if (d.__crm === "apply_label_v290") {
      try {
        await waitForWpp();
        if (typeof window.WPP?.labels?.addOrRemoveLabels !== "function") {
          throw new Error("Listas indisponíveis nesta versão do WhatsApp");
        }
        await window.WPP.labels.addOrRemoveLabels([d.waId], [{ labelId: String(d.labelId), type: "add" }]);
        window.postMessage({ __crm: "apply_label_done_v290", id: d.id, ok: true, data: true }, "*");
      } catch (e) {
        window.postMessage({ __crm: "apply_label_done_v290", id: d.id, ok: false, error: e?.message || String(e) }, "*");
      }
      return;
    }

    if (d.__crm === "action_v190") {
      try {
        if (!window.WPP?.chat) await sleep(2000);
        await runActions(d.phone, d.openOnly, d.actions, d.waId);
        window.postMessage({ __crm: "action_done_v190", id: d.id, ok: true }, "*");
      } catch (e) {
        window.postMessage({ __crm: "action_done_v190", id: d.id, ok: false, error: e?.message || String(e) }, "*");
      }
      return;
    }

    if (!["send_v180", "send_v170"].includes(d.__crm)) return;
    const ackType = d.__crm.replace("send", "sent");
    try {
      if (!window.WPP?.chat) await sleep(2000);
      await robustSend(d.phone, d.text);
      window.postMessage({ __crm: ackType, id: d.id, ok: true }, "*");
    } catch (e) {
      window.postMessage({ __crm: ackType, id: d.id, ok: false, error: e?.message || String(e) }, "*");
    }
  });

  console.info(`[CRM] Bridge ${BRIDGE_VERSION} (Native Engine) pronto.`);
})();

