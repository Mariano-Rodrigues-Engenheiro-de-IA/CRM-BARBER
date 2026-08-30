(function () {
  // Versão vem do content script via atributo do DOM (não window — os
  // dois rodam em "mundos" JS diferentes, um script injetado na página
  // não enxerga variáveis setadas em window pelo content script).
  const BRIDGE_VERSION = document.documentElement.getAttribute("data-crm-bridge-version") || "0.0.0";
  if (window.__crmWaBridgeVersion === BRIDGE_VERSION) return;
  window.__crmWaBridgeVersion = BRIDGE_VERSION;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const handledActionIds = new Set();
  let chatListEngineReady = false;

  function rememberAction(id) {
    if (!id || handledActionIds.has(id)) return false;
    handledActionIds.add(id);
    if (handledActionIds.size > 500) {
      const oldest = handledActionIds.values().next().value;
      if (oldest) handledActionIds.delete(oldest);
    }
    return true;
  }

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

  /** setChatList instala seu filtro customizado apenas no full-ready do wa-js.
   * WPP.chat existir antes disso não significa que o patch da lista já está
   * ativo; chamar cedo retorna sucesso sem alterar o resultado visual. */
  async function waitForChatListEngine() {
    for (let i = 0; i < 90; i += 1) {
      const chats = window.WPP?.whatsapp?.ChatStore?.getModelsArray?.() || [];
      if (
        window.WPP?.isFullReady === true &&
        typeof window.WPP?.chat?.setChatList === "function" &&
        typeof window.WPP?.whatsapp?.functions?.getShouldAppearInList === "function" &&
        chats.length > 0
      ) {
        // O wa-js agenda a instalação do patch de filtragem 1s depois de
        // isFullReady. Esperar uma única vez elimina a corrida em que
        // setChatList resolve, mas ainda usa o predicado original.
        if (!chatListEngineReady) {
          await sleep(1200);
          chatListEngineReady = true;
        }
        return window.WPP.whatsapp.ChatStore.getModelsArray();
      }
      await sleep(500);
    }
    throw new Error("A lista de conversas do WhatsApp ainda não está pronta");
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
    // Se o 'phone' já for um ID completo (ex: @lid ou @c.us), usa direto.
    const wid = String(phone || "").includes("@") ? phone : toWid(phone);

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
      ["openChatBottom", window.WPP?.chat?.openChatBottom, () => window.WPP.chat.openChatBottom(target)],
      ["openChatAt", window.WPP?.chat?.openChatAt, () => window.WPP.chat.openChatAt(target)],
      ["openChat", window.WPP?.chat?.openChat, () => window.WPP.chat.openChat(target)],
    ]
      .filter(([, real]) => typeof real === "function")
      .map(([label, , fn]) => [label, fn]);

    let lastError = "Não foi possível abrir a conversa";
    for (const [label, fn] of attempts) {
      const result = await tryStep(label, fn);
      if (result.ok) return target;
      lastError = result.error || lastError;
    }

    // Nunca navegar como fallback: trocar location reinicia a interface do
    // WhatsApp e podia deixar a tela cinza ao retomar a aba.
    throw new Error(lastError);
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
    // Ordem importa: nesta build o `chat.sendMessage` não existe, então tentar
    // por ele primeiro só gerava um erro e atraso a cada envio.
    const attempts = [
      ["sendTextMessage", () => {
        if (typeof window.WPP?.chat?.sendTextMessage !== "function") throw new Error("sendTextMessage indisponível");
        return window.WPP.chat.sendTextMessage(target, text, { waitForAck: false });
      }],
      ["chat.sendMessage", async () => {
        const chat = await getChatSafe(target);
        if (!chat || typeof chat.sendMessage !== "function") throw new Error("chat.sendMessage indisponível");
        return chat.sendMessage(text);
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
      // Cada passo pode ter seu próprio tempo de espera configurado
      // (editor de respostas rápidas); sem isso, usa o padrão de sempre.
      const waitMs = typeof action.delay_seconds === "number" ? action.delay_seconds * 1000 : 5000;
      await sleep(waitMs);
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
   * Índice LID → telefone/nome montado uma vez por coleta.
   *
   * Nas builds novas o WhatsApp identifica conversas por @lid (id interno de
   * privacidade) e o telefone só existe em outro modelo do ContactStore. Sem
   * cruzar os dois, o CRM recebia contato sem telefone e "Usuário desconhecido".
   */
  let lidIndex = new Map();

  function digitsOf(value) {
    const raw =
      typeof value === "object" && value
        ? (value._serialized ?? value.user ?? value.pn ?? value.phoneNumber ?? "")
        : value;
    const d = String(raw || "").split("@")[0].replace(/\D/g, "");
    return /^\d{10,14}$/.test(d) ? d : null;
  }

  function contactName(c) {
    const candidates = [
      c?.name,
      c?.verifiedName,
      c?.pushname,
      c?.notifyName,
      c?.formattedName,
      c?.displayName,
      c?.shortName,
      c?.header,
      c?.formattedShortNameWithContext,
    ];
    for (const v of candidates) {
      const s = String(v || "").trim();
      // Se o nome não for apenas o número de telefone, aceitamos.
      if (s && !/^\+?\d{9,}$/.test(s.replace(/[\s\-\(\)]/g, ""))) return s.slice(0, 160);
    }
    return null;
  }

  function buildLidIndex() {
    const index = new Map();
    const put = (key, phone, name) => {
      const k = String(key || "");
      if (!k) return;
      const cur = index.get(k) || {};
      index.set(k, { phone: cur.phone || phone || null, name: cur.name || name || null });
    };
    let models = [];
    try {
      models =
        window.WPP?.whatsapp?.ContactStore?.getModelsArray?.() ||
        window.WPP?.whatsapp?.ContactStore?.models ||
        [];
    } catch {}
    for (const c of models) {
      const id = serialized(c?.id);
      const lid = serialized(c?.lid) || serialized(c?.__x_lid);
      const phone = digitsOf(c?.phoneNumber) || digitsOf(id);
      const name = contactName(c);
      if (id) put(id, phone, name);
      if (lid) put(lid, phone, name);
      // Cruza os dois sentidos: @lid ↔ @c.us
      if (lid && phone) put(`${phone}@c.us`, phone, name);
    }
    return index;
  }

  /** Nome/telefone que o próprio remetente anuncia nas mensagens do chat. */
  function fromMessages(chat) {
    try {
      const coll = chat?.msgs;
      const msgs = coll?.getModelsArray?.() || coll?.models || [];
      for (let i = msgs.length - 1; i >= 0 && i > msgs.length - 25; i -= 1) {
        const m = msgs[i];
        if (m?.id?.fromMe) continue;
        const sender = m?.senderObj || m?.author || null;
        const phone = digitsOf(serialized(m?.author)) || digitsOf(sender?.phoneNumber);
        const name = contactName(sender) || String(m?.notifyName || "").trim() || null;
        if (phone || name) return { phone, name };
      }
    } catch {}
    return { phone: null, name: null };
  }

  /**
   * Telefone real da conversa. Conversas novas do WhatsApp usam @lid (id
   * interno) — nesse caso o número precisa ser buscado no ContactStore,
   * senão o CRM mostraria o LID no lugar do telefone.
   */
  function resolvePhoneDigits(chat, waId) {
    if (waId.endsWith("@g.us")) return null;
    if (waId.endsWith("@c.us")) return digitsOf(waId);

    let contact = null;
    try {
      contact = chat?.contact || window.WPP?.whatsapp?.ContactStore?.get?.(waId) || null;
    } catch {}

    const tries = [
      () => contact?.phoneNumber,
      () => serialized(contact?.id),
      () => contact?.userid,
      () => lidIndex.get(String(waId))?.phone,
      () => window.WPP?.whatsapp?.LidUtils?.getPhoneNumber?.(waId),
      () => window.WPP?.whatsapp?.functions?.getPhoneNumber?.(waId),
      () => window.WPP?.whatsapp?.LidStore?.get?.(waId)?.pn,
      () => window.WPP?.whatsapp?.LidPnCacheStore?.get?.(waId)?.pn,
      () => fromMessages(chat).phone,
    ];
    for (const get of tries) {
      let v;
      try { v = get(); } catch { continue; }
      const d = digitsOf(v);
      if (d) return d;
    }
    return null;
  }

  /** Nome exibível: passa por todas as fontes antes de desistir. */
  async function resolveProfilePicture(waId) {
    try {
      if (typeof window.WPP?.contact?.getProfilePictureUrl === "function") {
        return await window.WPP.contact.getProfilePictureUrl(waId);
      }
    } catch {}
    return null;
  }

  function resolveName(chat, waId) {
    let contact = null;
    try {
      contact = chat?.contact || window.WPP?.whatsapp?.ContactStore?.get?.(waId) || (chat?.id ? window.WPP?.whatsapp?.ContactStore?.get?.(chat.id) : null) || null;
    } catch {}
    
    const fromLid = lidIndex.get(String(waId));
    const candidates = [
      chat?.name,
      chat?.formattedTitle,
      chat?.__x_formattedTitle,
      contactName(contact),
      fromLid?.name,
      contactName(window.WPP?.whatsapp?.ContactStore?.get?.(fromLid?.phone + '@c.us')),
      fromMessages(chat).name,
    ];
    for (const c of candidates) {
      const v = String(c || "").trim();
      // Se não for um ID de sistema ou número puro muito longo, é um nome válido.
      if (v && !v.includes('@') && !/^\d{15,}$/.test(v.replace(/\D/g, ""))) return v.slice(0, 160);
    }
    const digits = resolvePhoneDigits(chat, waId || "");

    return digits ? `+${digits}` : "Usuário Desconhecido";
  }

  /**
   * Etiquetas reais do WhatsApp. Só aceitamos o que vem do LabelStore com
   * nome de verdade — listas "deduzidas" davam entradas fantasma no CRM que
   * nunca sincronizavam de volta.
   */
  // A cor da etiqueta pode vir como número ARGB (formato interno do
  // WhatsApp, ex: 4292960042) OU como string hex, dependendo da fonte.
  // CSS não entende o número puro — precisa converter pra "#rrggbb".
  function normalizeLabelColor(raw) {
    if (raw == null) return null;
    
    // Se for um número grande (ARGB)
    if (typeof raw === "number" || (!isNaN(raw) && !String(raw).startsWith("#"))) {
      const num = Number(raw);
      const u32 = num >>> 0;
      const r = (u32 >> 16) & 0xff;
      const g = (u32 >> 8) & 0xff;
      const b = u32 & 0xff;
      return "#" + [r, g, b].map(c => c.toString(16).padStart(2, "0")).join("");
    }

    const s = String(raw).trim();
    if (s.startsWith("#")) {
      if (s.length === 7) return s;
      if (s.length === 9) return "#" + s.slice(3); // Remove alpha de #AARRGGBB
      if (s.length === 4) return s;
    }
    if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s}`;
    
    return null;
  }

  async function readLabels() {
    // Paleta de cores (índice -> hex), buscada 1x. É necessária porque o
    // fallback cru (LabelStore.getModelsArray/.models) só expõe colorIndex
    // (um número que indexa a paleta fixa do WhatsApp), não uma cor pronta.
    // As fontes de alto nível (getAllLabels/getAll) já vêm com "hexColor"
    // calculado, mas quando essas falham (ex: timing no carregamento) e cai
    // no fallback cru, sem essa paleta a cor nunca é resolvida.
    let palette = null;
    try {
      palette = await window.WPP?.labels?.getLabelColorPalette?.();
      console.info("[CRM][diagnostico-cor] paleta:", JSON.stringify(palette));
    } catch (e) {
      const msg = e?.message || String(e);
      // "Etiquetas" é um recurso exclusivo do WhatsApp Business — em conta
      // pessoal, o WhatsApp recusa até a primeira chamada. Não adianta
      // tentar as outras fontes abaixo (também vão falhar/vir vazias); sai
      // cedo com lista vazia em vez de gerar mais ruído no console.
      if (/not a business version/i.test(msg)) {
        console.info("[CRM] Conta pessoal (não Business) — sem etiquetas do WhatsApp disponíveis.");
        return [];
      }
      console.warn("[CRM] paleta de cores de etiqueta indisponível:", msg);
    }
    function colorFromIndex(idx) {
      if (palette == null || idx == null) return null;
      const raw = Array.isArray(palette) ? palette[idx] : palette[String(idx)];
      return normalizeLabelColor(raw);
    }

    const sources = [
      () => window.WPP?.labels?.getAllLabels?.(),
      () => window.WPP?.labels?.getAll?.(),
      () => window.WPP?.whatsapp?.LabelStore?.getModelsArray?.(),
      () => window.WPP?.whatsapp?.LabelStore?.models,
    ];
    for (const [sourceIdx, get] of sources.entries()) {
      let list;
      try {
        list = get();
      } catch {
        continue;
      }
      if (!Array.isArray(list) || list.length === 0) continue;
      try {
        const seen = new WeakSet();
        console.info(
          "[CRM][diagnostico-cor] fonte",
          sourceIdx,
          "primeiro item bruto:",
          JSON.stringify(list[0], (k, v) => {
            if (typeof v === "function") return undefined;
            if (typeof v === "object" && v !== null) {
              if (seen.has(v)) return "[circular]";
              seen.add(v);
            }
            return v;
          }).slice(0, 800),
        );
      } catch (e) {
        console.warn("[CRM][diagnostico-cor] falha ao logar item bruto:", e?.message || e);
      }
      const out = [];
      for (const l of list) {
        const id = String(l?.id ?? l?.labelId ?? l?.__x_id ?? "");
        const name = String(l?.name ?? l?.__x_name ?? "").trim();
        if (!id || id === "undefined" || !name) continue;
        const directColor = normalizeLabelColor(
          l?.hexColor ?? l?.__x_hexColor ?? l?.color ?? l?.__x_color ?? l?.backgroundColor,
        );
        const colorIndex = l?.colorIndex ?? l?.__x_colorIndex;
        out.push({
          id,
          name: name.slice(0, 120),
          color: directColor ?? colorFromIndex(colorIndex),
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
          const chatId = serialized(it?.parentId) || serialized(it?.id);
          // Sem serialização válida, não dá pra usar o objeto cru (vira
          // "[object Object]" como string e quebra como "invalid wid"
          // mais adiante). Melhor pular o item do que salvar lixo.
          if (chatId) add(labelId, chatId);
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
    lidIndex = buildLidIndex();


    let labels = [];
    try {
      labels = await readLabels();
      console.info(
        "[CRM][diagnostico-cor] etiquetas coletadas:",
        JSON.stringify(labels.map((l) => ({ name: l.name, color: l.color }))),
      );
    } catch (e) {
      console.warn("[CRM] etiquetas indisponíveis:", e?.message || e);
    }

    const byChat = labelChatMap();
    const contacts = [];
    try {
      const known = new Set(labels.map((l) => l.id));
      for (const chat of chats.slice(0, 5000)) {
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
          profile_picture_url: null,
          unread_count: (() => {
            // unreadCount pode vir negativo no WhatsApp quando ele sabe que
            // tem não lida mas não sabe a contagem exata — nesse caso, 1.
            const raw = Number(chat?.unreadCount ?? chat?.__x_unreadCount ?? 0) || 0;
            return raw < 0 ? 1 : raw;
          })(),
        });
      }
    } catch (e) {
      console.warn("[CRM] conversas indisponíveis:", e?.message || e);
    }

    try {
      const seen = new Set(contacts.map((c) => c.wa_id));
      const known = new Set(labels.map((l) => l.id));
      for (const [chatId, labelSet] of byChat) {
        if (seen.has(chatId)) continue;
        const ids = [...labelSet].filter((id) => !known.size || known.has(id));
        if (!ids.length) continue;
        let contact = null;
        try { contact = window.WPP?.whatsapp?.ContactStore?.get?.(chatId) || null; } catch {}
        contacts.push({
          wa_id: chatId,
          phone: chatId.endsWith("@g.us") ? null : resolvePhoneDigits({ contact }, chatId),
          name: resolveName({ contact }, chatId),
          is_group: chatId.endsWith("@g.us"),
          label_ids: ids.slice(0, 50),
          last_message_at: null,
          profile_picture_url: null,
          unread_count: 0,
        });
        seen.add(chatId);
      }
    } catch (e) {
      console.warn("[CRM] membros de lista indisponíveis:", e?.message || e);
    }

    // Otimização: Busca fotos de perfil em paralelo para os top 300 contatos
    const topContacts = contacts.filter(c => !c.is_group).slice(0, 300);
    const BATCH_SIZE = 20;
    let fotoOk = 0;
    let fotoErro = 0;
    let primeiroErro = null;
    for (let i = 0; i < topContacts.length; i += BATCH_SIZE) {
      const batch = topContacts.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (c) => {
        try {
          c.profile_picture_url = await resolveProfilePicture(c.wa_id);
          if (c.profile_picture_url) fotoOk++;
          else fotoErro++;
        } catch (e) {
          fotoErro++;
          if (!primeiroErro) primeiroErro = e?.message || String(e);
        }
      }));
      await new Promise(r => setTimeout(r, 50));
    }
    console.info(
      "[CRM][diagnostico-foto]",
      `ok=${fotoOk} sem-foto-ou-erro=${fotoErro}`,
      primeiroErro ? `primeiro erro: ${primeiroErro}` : "(sem erro capturado)",
      "exemplo de url:",
      topContacts.find((c) => c.profile_picture_url)?.profile_picture_url || "(nenhuma)",
    );
    console.info(
      "[CRM][diagnostico-foto] getProfilePictureUrl existe?",
      typeof window.WPP?.contact?.getProfilePictureUrl,
    );

    const comNaoLida = contacts.filter((c) => (c.unread_count || 0) > 0);
    console.info(
      "[CRM][diagnostico-naolida]",
      `contatos com unread_count > 0: ${comNaoLida.length} de ${contacts.length}`,
      "exemplos:",
      JSON.stringify(comNaoLida.slice(0, 5).map((c) => ({ name: c.name, unread_count: c.unread_count }))),
    );

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

    if (d.__crm === "profile_picture_v1") {
      try {
        await waitForWpp();
        const url = await resolveProfilePicture(d.waId);
        window.postMessage({ __crm: "profile_picture_done_v1", id: d.id, ok: true, data: { url: url || null } }, "*");
      } catch (e) {
        window.postMessage({ __crm: "profile_picture_done_v1", id: d.id, ok: false, error: e?.message || String(e) }, "*");
      }
      return;
    }

    if (d.__crm === "active_chat_v290") {
      try {
        await waitForWpp();
        let chat =
          (typeof window.WPP?.chat?.getActiveChat === "function" && window.WPP.chat.getActiveChat()) ||
          null;
        let usedFallback = false;
        // Reserva: se getActiveChat() não achar nada (aconteceu bastante
        // pra contatos não salvos, segundo os testes), tenta pegar direto
        // pelo id que o content script já leu do próprio DOM.
        if (!chat && d.domWaId) {
          try {
            chat = (await window.WPP?.chat?.get?.(d.domWaId)) || null;
            usedFallback = !!chat;
          } catch {}
        }
        if (!chat) {
          throw new Error("Nenhuma conversa aberta");
        }
        const waId = serialized(chat?.id) || d.domWaId;
        let contact = null;
        try {
          // Uma busca só (rápida) — as tentativas extras de resolução por
          // @lid nas rodadas anteriores deixaram isso mais lento sem
          // resolver o problema de verdade, então voltamos pro simples.
          contact = chat?.contact || (await window.WPP?.contact?.get?.(waId)) || null;
        } catch {}
        const isSaved = contact?.isMyContact === true;
        const pushName = String(contact?.pushname || contact?.notifyName || "").trim() || null;
        const data = {
          wa_id: waId,
          phone: resolvePhoneDigits(chat, waId || ""),
          name: resolveName(chat, waId || ""),
          is_group: String(waId || "").endsWith("@g.us"),
          is_saved: isSaved,
          push_name: pushName,
        };
        window.postMessage({ __crm: "active_chat_done_v290", id: d.id, ok: true, data }, "*");
      } catch (e) {
        window.postMessage({ __crm: "active_chat_done_v290", id: d.id, ok: false, error: e?.message || String(e) }, "*");
      }
      return;
    }

    // Salva o contato de verdade dentro do WhatsApp — mesma função por
    // trás do botão nativo "Adicionar" que aparece quando abre os dados
    // de um contato não salvo. Não depende de nenhuma API externa: é a
    // própria função exportada pela wa-js (WPPConnect) que a extensão já
    // carrega. https://wppconnect.io/wa-js/functions/whatsapp.WPP.contact.save.html
    if (d.__crm === "save_contact_v1") {
      try {
        await waitForWpp();
        if (typeof window.WPP?.contact?.save !== "function") {
          throw new Error("Função de salvar contato indisponível nessa versão do WhatsApp Web.");
        }
        await window.WPP.contact.save(d.waId, d.name, { syncAddressBook: true });
        window.postMessage({ __crm: "save_contact_done_v1", id: d.id, ok: true }, "*");
      } catch (e) {
        window.postMessage({ __crm: "save_contact_done_v1", id: d.id, ok: false, error: e?.message || String(e) }, "*");
      }
      return;
    }

    if (d.__crm === "apply_label_v290") {
      try {
        await waitForWpp();
        if (typeof window.WPP?.labels?.addOrRemoveLabels !== "function") {
          throw new Error("Listas indisponíveis nesta versão do WhatsApp");
        }
        const op = d.op === "remove" ? "remove" : "add";
        await window.WPP.labels.addOrRemoveLabels([d.waId], [{ labelId: String(d.labelId), type: op }]);
        window.postMessage({ __crm: "apply_label_done_v290", id: d.id, ok: true, data: true }, "*");
      } catch (e) {
        window.postMessage({ __crm: "apply_label_done_v290", id: d.id, ok: false, error: e?.message || String(e) }, "*");
      }
      return;
    }

    // Filtro da lista de conversas do WhatsApp. O WPP só existe aqui no MAIN
    // world — o content script precisa passar por esta ponte.
    if (d.__crm === "chatlist_v350") {
      try {
        const chats = await waitForChatListEngine();
        if (d.listType === "all") await window.WPP.chat.setChatList("all");
        else await window.WPP.chat.setChatList(d.listType, d.ids || []);
        await sleep(100);

        const shouldAppear = window.WPP.whatsapp.functions.getShouldAppearInList;
        const visible = chats.filter((chat) => {
          try { return shouldAppear(chat); } catch { return false; }
        }).length;
        if (d.listType === "custom" && (d.ids || []).length > 0 && visible === 0) {
          await window.WPP.chat.setChatList("all");
          throw new Error("Nenhuma conversa corresponde aos IDs recebidos pelo filtro");
        }
        console.info(`[CRM][chatlist] ${d.listType}: ${visible} conversa(s) confirmada(s)`);
        window.postMessage({
          __crm: "chatlist_done_v350",
          id: d.id,
          ok: true,
          data: { visible, total: chats.length },
        }, "*");
      } catch (e) {
        console.warn("[CRM][chatlist] ERRO:", e?.message || e);
        window.postMessage({ __crm: "chatlist_done_v350", id: d.id, ok: false, error: e?.message || String(e) }, "*");
      }
      return;
    }


    if (d.__crm === "action_v342") {
      if (!rememberAction(d.id)) return;
      try {
        if (!window.WPP?.chat) await sleep(2000);
        await runActions(d.phone, d.openOnly, d.actions, d.waId);
        window.postMessage({ __crm: "action_done_v339", id: d.id, ok: true }, "*");
      } catch (e) {
        window.postMessage({ __crm: "action_done_v339", id: d.id, ok: false, error: e?.message || String(e) }, "*");
      }
      return;
    }

  });

  console.info(`[CRM] Bridge ${BRIDGE_VERSION} (Native Engine) pronto.`);
})();

