// Content script v0.25.0 — abas do CRM no topo do WhatsApp Web + trilho de
// ícones minimalista à esquerda. Clicar numa aba/lista filtra a própria
// lista de conversas do WhatsApp (não abre o CRM).

(function () {
  // Versão lida direto do manifest.json — fonte única. Antes eram duas
  // constantes fixas (aqui e na ponte) que eu esquecia de sincronizar a
  // cada atualização, o que já causou confusão de "será que é a versão
  // nova mesmo?" tanto pra mim quanto pra quem está testando.
  const CRM_VERSION = chrome.runtime.getManifest().version;
  const EXTENSION_BRIDGE_TOKEN = "__extension_bridge__";
  const SHELL_CLASS = "crm-shell";
  if (window.__crmAssinaturasInjectedVersion === CRM_VERSION) return;
  window.__crmAssinaturasInjectedVersion = CRM_VERSION;
  document.getElementById("crm-assinaturas-panel")?.remove();
  document.getElementById("crm-rail")?.remove();
  document.getElementById("crm-topbar")?.remove();
  document.body?.classList.remove("crm-assinaturas-docked", "crm-assinaturas-docked-collapsed");
  console.info(`[CRM ct v${CRM_VERSION}] carregado`, location.href);


  // Injetar wa-js + bridge no MAIN world, mas SÓ depois que o WhatsApp
  // registrar seus módulos internos (workaround upstream issue #3419:
  // negative-cache permanente quando injetado em document_start).
  function injectMain(file) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = chrome.runtime.getURL(file);
      s.onload = () => { s.remove(); resolve(); };
      s.onerror = reject;
      (document.head || document.documentElement).appendChild(s);
    });
  }
  function waitForWaReady() {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        // Sinais de que o app registrou os módulos: existe #app e alguma
        // chave localStorage do WhatsApp foi populada (WAToken/WABrowserId
        // ou last-wid). Timeout de 30s de segurança.
        const hasApp = !!document.getElementById("app");
        let hasStore = false;
        try {
          hasStore = !!(localStorage.getItem("WAToken1") ||
                        localStorage.getItem("WABrowserId") ||
                        localStorage.getItem("last-wid-md") ||
                        localStorage.getItem("last-wid"));
        } catch {}
        if ((hasApp && hasStore) || Date.now() - start > 30000) return resolve();
        setTimeout(tick, 500);
      };
      tick();
    });
  }
  let waScriptsPromise = null;
  function ensureWaScriptsInjected() {
    if (waScriptsPromise) return waScriptsPromise;
    window.__crmWaJsInjected = true;
    // A ponte roda em outro "mundo" JS (script injetado na própria
    // página) — não compartilha o window do content script (mundo
    // isolado), então setar window.__crmBridgeVersion aqui não chegava
    // lá (foi isso que deu "Bridge 0.0.0"). Atributo do DOM, sim, é
    // compartilhado entre os dois mundos.
    document.documentElement.setAttribute("data-crm-bridge-version", CRM_VERSION);
    waScriptsPromise = waitForWaReady()
      .then(() => injectMain("wa-js.js"))
      .then(() => injectMain("wa-bridge-v15.js"))
      .then(() => console.info(`[CRM ct v${CRM_VERSION}] wa-js injetado (deferido)`))
      .catch((e) => {
        window.__crmWaJsInjected = false;
        waScriptsPromise = null;
        console.warn("[CRM ct] falha injetando wa-js", e);
        throw e;
      });
    return waScriptsPromise;
  }
  // Injeção sob demanda: o wa-js engancha nos módulos internos do WhatsApp e
  // deixa o boot muito mais lento. Não injetamos mais no load — só quando o
  // usuário pede algo que precisa do motor (sincronizar, disparar, responder)
  // ou na primeira sincronização em segundo plano, bem depois do boot.
  //
  // Prewarm: o primeiro envio ficava travado esperando a injeção do motor.
  // Aquecemos em segundo plano (sem bloquear nada) assim que o usuário
  // demonstra intenção — passar o mouse nos botões, abrir um pop-up — e
  // também um tempo depois do boot, quando a aba está ociosa.
  function prewarmEngine() {
    if (document.visibilityState !== "visible") return;
    ensureWaScriptsInjected()
      .then(() => {
        // Primeira sincronização automática rápida após o boot (5s depois)
        setTimeout(() => syncWaData(), 5000);
        // Segunda sincronização um pouco depois para garantir que o WPP carregou as fotos
        setTimeout(() => syncWaData(), 15000);
      })
      .catch(() => null);
  }
  setTimeout(prewarmEngine, 10000); // Reduzi para 10s para ser mais rápido

  // Sincronização automática a cada 3 minutos (mais frequente para capturar mudanças)
  setInterval(() => {
    if (document.visibilityState === "visible" && status.paired) {
      syncWaData();
    }
  }, 3 * 60 * 1000);


  let pollHeartbeat = null;
  let railRef = null;
  let topbarRef = null;
  let status = { paired: false };
  let funnels = [];
  let billing = null;
  let waData = { labels: [], contacts: [] };
  let quickReplies = [];
  let quickReplyCategories = [];
  let quickReplySending = false;
  let syncTimer = null;
  let syncing = false;
  let pairHint = null;

  function readLoggedPhone() {
    try {
      const raw = localStorage.getItem("last-wid-md") || localStorage.getItem("last-wid") || "";
      const m = raw.match(/(\d{8,15})/);
      return m ? m[1] : null;
    } catch { return null; }
  }

  /** Pede etiquetas/conversas ao bridge (MAIN world) via postMessage. */
  /** Query de identificação do contato — manda os dois campos quando
   * disponíveis (não só um), porque um registro pode ter sido salvo com
   * qualquer um dos dois (ex: nota criada no WhatsApp antes do contato
   * sincronizar só tinha telefone; card do CRM só tinha wa_contact_id) —
   * sem os dois, a busca não encontrava um pelo outro. */
  function contactIdentityQuery(waContactId, phone) {
    const parts = [];
    if (waContactId) parts.push(`wa_contact_id=${encodeURIComponent(waContactId)}`);
    if (phone) parts.push(`phone=${encodeURIComponent(phone)}`);
    return parts.length ? parts.join("&") : null;
  }

  function askBridgeCollect() {
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      const timeout = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        resolve(null);
      }, 60000);
      function onMessage(ev) {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.__crm !== "collect_done_v200" || d.id !== id) return;
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        resolve(d.ok ? d.data : null);
      }
      window.addEventListener("message", onMessage);
      window.postMessage({ __crm: "collect_v200", id }, "*");
    });
  }

  /** Coleta local + envio para o CRM. Silencioso: nunca quebra a interface. */
  async function syncWaData() {
    if (syncing) return;
    syncing = true;
    renderTopbar();
    try {
      await ensureWaScriptsInjected().catch(() => null);
      const data = await askBridgeCollect();
      if (!data) return;
      waData = data;
      await chrome.runtime.sendMessage({
        type: "api",
        path: "/api/public/extension/wa/sync",
        opts: { method: "POST", body: JSON.stringify(data) },
      }).catch(() => null);
      console.info(`[CRM ct] sincronizado: ${data.labels.length} etiqueta(s), ${data.contacts.length} conversa(s)`);
    } finally {
      syncing = false;
      renderTopbar();
    }
  }

  async function loadWaData() {
    const r = await chrome.runtime
      .sendMessage({ type: "api", path: "/api/public/extension/wa/data" })
      .catch(() => null);
    if (!r?.ok) return;
    waData = { labels: r.labels || [], contacts: r.contacts || [] };
    renderTopbar();
    renderDrawer();
  }


  async function loadFunnels() {
    const r = await chrome.runtime
      .sendMessage({ type: "api", path: "/api/public/extension/funnels" })
      .catch(() => null);
    if (r?.ok) {
      funnels = r.funnels || [];
      renderTopbar();
      renderDrawer();
      updateFunnelBadge();
      updateFollowupBadge();
      updateNotesBadge();
      updateScheduleBadge();
    }
  }

  async function loadQuickReplies() {
    const r = await chrome.runtime
      .sendMessage({ type: "api", path: "/api/public/extension/quick-replies" })
      .catch(() => null);
    if (r?.ok) quickReplies = r.quick_replies || [];
  }

  async function loadQuickReplyCategories() {
    const r = await chrome.runtime
      .sendMessage({ type: "api", path: "/api/public/extension/quick-reply-categories" })
      .catch(() => null);
    if (r?.ok) quickReplyCategories = r.categories || [];
  }

  function painelUrl(section, extra) {
    const base = status.api_base || "";
    const token = status.token || EXTENSION_BRIDGE_TOKEN;
    return `${base}/painel?token=${encodeURIComponent(token)}${section ? `&section=${section}` : ""}${extra || ""}`;
  }

  function openPainel(section, extra) {
    window.open(painelUrl(section, extra), "_blank", "noopener");
  }

  const ICONS = {
    funnel: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h18l-7 8v7l-4 2v-9L3 4z"/></svg>`,
    sync: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>`,
    gear: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7"/></svg>`,
    exit: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>`,
    send: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/></svg>`,
    chat: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg>`,
    calendar: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
    badge: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.3 11 14.8l4.5-5"/></svg>`,
    ranking: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="13" width="4.5" height="7" rx="1"/><rect x="9.75" y="9" width="4.5" height="11" rx="1"/><rect x="16" y="4.5" width="4.5" height="15.5" rx="1"/></svg>`,
    robot: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8.5" width="18" height="12.5" rx="2.5"/><path d="M12 8.5V4"/><circle cx="12" cy="2.5" r="1.6"/><circle cx="8.5" cy="14.5" r="1.2"/><circle cx="15.5" cy="14.5" r="1.2"/><path d="M1 12.5v4M23 12.5v4"/></svg>`,
    cap: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M23 9 12 3 1 9l11 6 11-6Z"/><path d="M5 11.5v5c0 1.8 3.1 3.5 7 3.5s7-1.7 7-3.5v-5"/><path d="M23 9v7"/></svg>`,
    link: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="6.5" y="2.5" width="11" height="19" rx="2.2"/><path d="M10.5 18.2h3"/></svg>`,
    clock: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 3.5"/></svg>`,
    account: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-3.9 3.6-7 8-7s8 3.1 8 7"/></svg>`,
  };

  const GEAR_SVG = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
  const FILTER_SVG = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h18l-7 8v7l-4 2v-9L3 4z"/></svg>`;

  let autoSyncTried = false;
  let topbarFilter = "tabs";
  try {
    topbarFilter = localStorage.getItem("crm-topbar-filter") || "tabs";
  } catch {}

  function buildShell() {
    const rail = document.createElement("div");
    rail.id = "crm-rail";
    rail.innerHTML = `
      <div class="crm-rail-mark"><img src="${chrome.runtime.getURL("zaylo-icon.png")}" alt="Zaylo CRM" /></div>
      <button class="crm-rail-btn" data-go="agenda" data-label="Agenda">${ICONS.calendar}</button>
      <button class="crm-rail-btn" data-go="funis" data-label="Funis de Vendas">${ICONS.funnel}</button>
      <button class="crm-rail-btn" data-go="disparo" data-label="Disparo">${ICONS.send}</button>
      <button class="crm-rail-btn" data-go="assinantes" data-label="Assinaturas">${ICONS.badge}</button>
      <button class="crm-rail-btn" data-go="equipe" data-label="Ranking de vendas">${ICONS.ranking}</button>
      <button class="crm-rail-btn" data-go="agente-ia" data-label="Agente de IA">${ICONS.robot}</button>
      <button class="crm-rail-btn" data-go="treinamento" data-label="Treinamentos">${ICONS.cap}</button>
      <button class="crm-rail-btn" data-go="conexao" data-label="Conexão">${ICONS.link}</button>
      <div class="crm-rail-divider"></div>
      <div class="crm-rail-spacer"></div>
      <button class="crm-rail-btn" data-go="configuracoes" data-label="Configurações">${ICONS.gear}</button>
      <button class="crm-rail-btn" data-act="unpair" data-label="Desvincular">${ICONS.exit}</button>
    `;
    document.body.appendChild(rail);
    railRef = rail;

    const topbar = document.createElement("div");
    topbar.id = "crm-topbar";
    document.body.appendChild(topbar);
    topbarRef = topbar;

    document.body.classList.add(SHELL_CLASS);

    rail.addEventListener("click", async (e) => {
      const btn = e.target.closest(".crm-rail-btn");
      if (!btn) return;
      const go = btn.getAttribute("data-go");
      if (go) return openPainel(go);
      const act = btn.getAttribute("data-act");
      if (act === "sync") {
        syncing = false;
        syncWaData();
        return;
      }
      if (act === "unpair") {
        const ok = await crmConfirm({
          title: "Desvincular esta conta?",
          body: "O CRM para de disparar por este WhatsApp até você vincular de novo.",
          confirmLabel: "Desvincular",
        });
        if (!ok) return;
        await chrome.runtime.sendMessage({ type: "unpair" });
        refresh();
      }
    });

    topbar.addEventListener("click", (e) => {
      const funnelPicker = e.target.closest("[data-open-funnel-picker]");
      if (funnelPicker) {
        e.stopPropagation();
        return openTopbarFunnelPicker(funnelPicker);
      }

      const gear = e.target.closest(".crm-pill-gear");
      if (gear) {
        e.stopPropagation();
        return openStageMenu(gear, gear.getAttribute("data-funnel"), gear.getAttribute("data-stage"));
      }

      const premium = e.target.closest("[data-premium]");
      if (premium) {
        window.open(`${status.api_base || ""}/assinar`, "_blank", "noopener");
        return;
      }

      const accountBtn = e.target.closest("[data-open-account]");
      if (accountBtn) {
        e.stopPropagation();
        if (document.querySelector(".crm-account-pop")) {
          document.querySelector(".crm-account-pop")?.remove();
          return;
        }
        return openAccountPopover(accountBtn);
      }

      const addBtn = e.target.closest(".crm-pill-add-icon");
      if (addBtn) {
        if (document.querySelector(".crm-lite-pop")) {
          document.querySelector(".crm-lite-pop")?.remove();
          return;
        }
        return createTab(addBtn);
      }

      const pill = e.target.closest(".crm-pill");
      if (!pill) return;
      const stageId = pill.getAttribute("data-stage");
      if (stageId) return filterByStage(pill.getAttribute("data-funnel"), stageId);
    });

    renderTopbar();
  }

  function formatBRL(cents) {
    return ((cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  /** Menu flutuante ancorado a um elemento (substitui menus nativos). */
  /** Transição suave de entrada — evita o popover "estalar" na tela. */
  function animatePopIn(pop) {
    requestAnimationFrame(() => requestAnimationFrame(() => pop.classList.add("is-in")));
  }

  // ---------------------------------------------------------------------
  // Painel único docado — raio, funil, perfil e valor compartilham o MESMO
  // container. Clicar num ícone diferente troca o conteúdo (com uma
  // bolinha de carregamento rápida) em vez de fechar e abrir de novo; só
  // clicar de novo no MESMO ícone fecha.
  // ---------------------------------------------------------------------
  let activePanelKind = null; // "qr" | "funnel" | "profile" | "deal" | null
  // Qual conversa (wa_id) está sendo mostrada no painel de Perfil agora —
  // usado só pra saber quando precisa atualizar sozinho (troca de
  // conversa com o painel já aberto), sem duplicar o de activePanelKind.
  let profilePanelWaId = null;
  // O painel é reaproveitado entre trocas de ícone (não criado do zero a
  // cada vez), então NÃO dá pra usar addEventListener direto em cada
  // render — acumularia um listener por cada troca. Um listener só,
  // fixado na criação do painel, delega pro handler da função atual.
  let panelClickHandler = null;
  let panelChangeHandler = null;
  let panelInputHandler = null;

  function ensureSharedPanel() {
    let panel = document.querySelector(".crm-qrp");
    if (panel) return panel;
    panel = document.createElement("div");
    panel.className = "crm-qrp";
    panel.addEventListener("click", (e) => panelClickHandler?.(e));
    panel.addEventListener("change", (e) => panelChangeHandler?.(e));
    panel.addEventListener("input", (e) => panelInputHandler?.(e));
    document.body.appendChild(panel);
    document.body.classList.add("crm-qr-open");
    animatePopIn(panel);
    return panel;
  }

  function closeSharedPanel() {
    document.querySelector(".crm-qrp")?.remove();
    document.body.classList.remove("crm-qr-open");
    activePanelKind = null;
    profilePanelWaId = null;
  }

  function showPanelSpinner(panel) {
    panel.innerHTML = `<div class="crm-qrp-swap-loading"><span class="crm-qrp-spin-lg"></span></div>`;
  }

  async function openSharedPanel(kind) {
    if (activePanelKind === kind) {
      closeSharedPanel();
      return;
    }
    const isSwap = activePanelKind !== null;
    activePanelKind = kind;
    panelClickHandler = null;
    panelChangeHandler = null;
    panelInputHandler = null;
    const panel = ensureSharedPanel();
    if (isSwap) showPanelSpinner(panel);
    if (kind === "qr") await renderQuickReplyPanel(panel);
    else if (kind === "profile" || kind === "deal") await renderProfilePanel(panel);
  }

  /** Fileira de 2 ícones (raio / perfil) que fica no topo do painel
   * compartilhado, pra trocar de seção sem fechar nada. Perfil e Valor do
   * cliente são um formulário só. */
  function panelSwitcherHtml(activeKind) {
    const items = [
      { kind: "qr", icon: BOLT_SVG, label: "Respostas rápidas" },
      { kind: "profile", icon: PROFILE_SVG, label: "Perfil do cliente" },
    ];
    return `<div class="crm-qrp-switcher">
      ${items
        .map(
          (it) => `<button class="crm-qrp-switch-btn${it.kind === activeKind ? " is-active" : ""}" data-switch="${it.kind}" title="${escapeHtml(it.label)}">${it.icon}</button>`,
        )
        .join("")}
    </div>`;
  }

  /** Prompt leve — ancorado no botão que abriu, sem escurecer/desfocar a
   * tela. Usado no lugar do crmPrompt() (modal cheio) nos pontos em que
   * queremos a sensação de algo nativo do WhatsApp — ex: nova etapa. */
  function openInlinePrompt(anchor, { title, value = "", confirmLabel = "Salvar" }) {
    return new Promise((resolve) => {
      document.querySelector(".crm-lite-pop")?.remove();
      const pop = document.createElement("div");
      pop.className = "crm-lite-pop";
      const rect = anchor.getBoundingClientRect();
      pop.style.top = `${rect.bottom + 8}px`;
      pop.style.left = `${Math.min(Math.max(8, rect.left), window.innerWidth - 260)}px`;
      pop.innerHTML = `
        <p class="crm-lite-pop-title">${escapeHtml(title)}</p>
        <input class="crm-lite-pop-input" value="${escapeHtml(value)}" maxlength="60" />
        <button class="crm-lite-pop-confirm">${escapeHtml(confirmLabel)}</button>
      `;
      document.body.appendChild(pop);
      animatePopIn(pop);
      const input = pop.querySelector(".crm-lite-pop-input");
      const done = (v) => {
        pop.remove();
        document.removeEventListener("mousedown", onDoc, true);
        resolve(v);
      };
      function onDoc(ev) {
        if (!pop.contains(ev.target) && ev.target !== anchor) done(null);
      }
      // 150ms de folga (não 0) — dá uma margem de segurança contra
      // qualquer resquício do mesmo clique que abriu a caixinha acabar
      // fechando ela sozinha antes da pessoa conseguir digitar.
      setTimeout(() => document.addEventListener("mousedown", onDoc, true), 150);
      pop.querySelector(".crm-lite-pop-confirm").addEventListener("click", () => done(input.value.trim() || null));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") done(input.value.trim() || null);
        if (e.key === "Escape") done(null);
      });
      setTimeout(() => input.focus(), 30);
    });
  }

  /** Confirmação leve — ancorada no botão que abriu, tipo "tem certeza?"
   * nativo do WhatsApp. Usada em exclusões dentro dos painéis (sem
   * escurecer a tela, sem modal pesado). */
  function openConfirmPop(anchor, { text, confirmLabel = "Confirmar", danger = true }) {
    return new Promise((resolve) => {
      document.querySelectorAll(".crm-lite-pop, .crm-confirm-pop").forEach((el) => el.remove());
      const pop = document.createElement("div");
      pop.className = "crm-confirm-pop";
      const rect = anchor.getBoundingClientRect();
      pop.style.top = `${rect.bottom + 8}px`;
      pop.style.left = `${Math.min(Math.max(8, rect.left - 200), window.innerWidth - 240)}px`;
      pop.innerHTML = `
        <p class="crm-confirm-pop-text">${escapeHtml(text)}</p>
        <div class="crm-confirm-pop-actions">
          <button class="crm-confirm-pop-cancel">Cancelar</button>
          <button class="crm-confirm-pop-yes${danger ? " is-danger" : ""}">${escapeHtml(confirmLabel)}</button>
        </div>
      `;
      document.body.appendChild(pop);
      animatePopIn(pop);
      const done = (v) => {
        pop.remove();
        document.removeEventListener("mousedown", onDoc, true);
        resolve(v);
      };
      function onDoc(ev) {
        if (!pop.contains(ev.target) && ev.target !== anchor) done(false);
      }
      setTimeout(() => document.addEventListener("mousedown", onDoc, true), 0);
      pop.querySelector(".crm-confirm-pop-cancel").addEventListener("click", () => done(false));
      pop.querySelector(".crm-confirm-pop-yes").addEventListener("click", () => done(true));
    });
  }

  function openMenu(anchor, items) {
    document.querySelector(".crm-menu")?.remove();
    const rect = anchor.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.className = "crm-menu";
    menu.style.top = `${rect.bottom + 6}px`;
    menu.innerHTML = items
      .map(
        (i, idx) =>
          `<button data-i="${idx}"${i.danger ? ' class="crm-menu-danger"' : ""}>${escapeHtml(i.label)}</button>`,
      )
      .join("");
    document.body.appendChild(menu);
    // Precisa medir DEPOIS de anexar ao DOM (offsetWidth só existe depois
    // de renderizado) — o painel fica encostado na borda direita da tela,
    // então só grudar no rect.left do botão fazia o menu sair pra fora
    // quando o botão estava perto dessa borda.
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - menu.offsetWidth - 8);
    menu.style.left = `${left}px`;
    const close = () => {
      menu.remove();
      document.removeEventListener("mousedown", onDoc, true);
    };
    function onDoc(ev) {
      if (!menu.contains(ev.target)) close();
    }
    setTimeout(() => document.addEventListener("mousedown", onDoc, true), 0);
    menu.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-i]");
      if (!b) return;
      close();
      items[Number(b.getAttribute("data-i"))].onClick();
    });
  }

  function setTopbarFilter(value) {
    topbarFilter = value;
    try { localStorage.setItem("crm-topbar-filter", value); } catch {}
    renderTopbar();
  }

  /** Nome do filtro ativo (usado no botão da barra) — só existe o Funil
   * principal agora. "Listas" saiu: o filtro de etiquetas do WhatsApp
   * estava instável (funcionava numa hora, na outra não) e a prioridade
   * é ter o Funil principal funcionando 100% do tempo. */
  function currentFilterLabel() {
    return currentFunnel()?.name || "ESCOLHER FUNIL";
  }

  let selectedTopbarFunnelId = null;
  try {
    selectedTopbarFunnelId = localStorage.getItem("crm-topbar-funnel-id") || null;
  } catch {}

  function nonLabelFunnels() {
    return funnels.filter((f) => f.mode !== "label");
  }

  // Antes só existia UM funil possível aqui ("Funil principal" / modo
  // "tab"). Agora dá pra ter vários — o que aparece como abas lá em cima
  // é sempre o último funil escolhido no seletor (persistido, sobrevive
  // a fechar e abrir o WhatsApp de novo). Sem nada escolhido ainda (ou o
  // escolhido foi apagado), cai no primeiro da lista.
  function currentFunnel() {
    const list = nonLabelFunnels();
    if (!list.length) return null;
    const found = selectedTopbarFunnelId && list.find((f) => f.id === selectedTopbarFunnelId);
    return found || list[0];
  }

  function setSelectedTopbarFunnel(funnelId) {
    selectedTopbarFunnelId = funnelId;
    try { localStorage.setItem("crm-topbar-funnel-id", funnelId); } catch {}
    activeFilter = null; // filtro de pílula (etapa) era de outro funil, não faz mais sentido
    renderTopbar();
  }

  function openTopbarFunnelPicker(anchor) {
    const list = nonLabelFunnels();
    if (!list.length) {
      crmToast("Nenhum funil criado ainda.", "err", anchor);
      return;
    }
    openMenu(
      anchor,
      list.map((f) => ({ label: f.name, onClick: () => setSelectedTopbarFunnel(f.id) })),
    );
  }

  // ---------------------------------------------------------------------
  // Listas e etapas de funil funcionais dentro do WhatsApp:
  // clicar numa pílula abre a gaveta com os contatos daquele grupo e ainda
  // tenta aplicar o filtro nativo da lista de conversas.
  // ---------------------------------------------------------------------
  let activeFilter = null; // { key, kind, id, funnelId, name }
  let filterLoadingKey = null; // chave da pílula esperando o WhatsApp confirmar o filtro
  let nativeTabWatcherReady = false;

  /** IDs completos (@lid/@c.us/@g.us) que o motor interno do WhatsApp usa.
   * Não normalizamos para dígitos: o wa-js 4.5.0 já cruza LID ↔ telefone pelo
   * cache interno, enquanto um ID sem sufixo nunca é um WID válido. */
  function getStageWaIds(funnelId, stageId) {
    const funnel = funnels.find((f) => f.id === funnelId);
    if (!funnel) return new Set();
    return new Set(
      (funnel.cards || [])
        .filter((c) => c.stage_id === stageId && c.wa_id)
        .map((c) => String(c.wa_id))
    );
  }

  /** Conjunto de WIDs permitidos pelo filtro atual (null = sem filtro). */
  function getActiveFilterWaIds() {
    if (!activeFilter) return null;
    if (activeFilter.kind === "label") {
      const target = String(activeFilter.id);
      return new Set(
        (waData.contacts || [])
          .filter((c) => (c.label_ids || c.labels || []).some((label) => {
            const id = typeof label === "object" ? (label?.id ?? label?.wa_label_id) : label;
            return String(id || "") === target;
          }))
          .map((c) => String(c.wa_id || ""))
          .filter(Boolean),
      );
    }
    if (activeFilter.kind === "stage") {
      return getStageWaIds(activeFilter.funnelId, activeFilter.id);
    }
    return null;
  }

  /** Ouve cliques nas abas nativas do WhatsApp (Tudo / Não lidas / Favoritas /
   * Grupos e as abas de etiqueta). Quando o usuário volta pra uma aba nativa,
   * o nosso filtro precisa sair de cena: com "labels" o WhatsApp reseta
   * sozinho, mas com "custom" (funis) a lista interna continua presa e o
   * observer do DOM segue escondendo linhas — era isso que travava a volta
   * pro inbox completo. */
  function ensureNativeTabWatcher() {
    if (nativeTabWatcherReady) return;
    nativeTabWatcherReady = true;
    document.addEventListener(
      "click",
      (ev) => {
        if (!activeFilter) return;
        const target = ev.target;
        if (!(target instanceof Element)) return;
        // Ignora cliques na nossa própria UI (topbar, gaveta, pílulas).
        if (target.closest("#crm-topbar, #crm-drawer, #crm-rail, [data-crm]")) return;
        const tab = target.closest('[role="tab"], button[aria-pressed]');
        if (!tab) return;
        // Só reage a abas dentro do painel de conversas.
        if (!tab.closest("#pane-side, header, [data-tab='chatlist']") && !tab.closest('[role="tablist"]')) return;
        const label = (tab.getAttribute("aria-label") || tab.textContent || "").toLowerCase();
        // Só forçamos o reset da lista interna quando o destino é o inbox
        // completo; nas demais abas o próprio WhatsApp assume a lista.
        releaseChatFilter(/\btudo\b|\ball\b/.test(label) || label === "");
      },
      true,
    );
  }

  /** Solta o filtro do CRM sem forçar nenhuma lista: devolve o controle da
   * lista de conversas para o WhatsApp. */
  function releaseChatFilter(forceAll = true) {
    const hadCustom = forceAll && activeFilter?.kind === "stage";
    activeFilter = null;
    closeDrawer();
    renderTopbar();
    // Lista "custom" não é uma aba real: sem resetar explicitamente, o
    // WhatsApp continua renderizando o conjunto travado.
    if (hadCustom) {
      void (async () => {
        try {
          await ensureWaScriptsInjected();
          await askBridge("chatlist_v350", "chatlist_done_v350", { listType: "all", ids: [] }, 15000);
        } catch (e) {
          console.warn("[CRM] falha ao liberar filtro de lista:", e?.message || e);
        }
      })();
    }
  }


  /** Aplica e valida o filtro no estado interno do WhatsApp. A lista é
   * virtualizada e não expõe mais um ID estável no DOM, então não há fallback
   * visual por seletor nem comparação frágil por nome. */
  async function applyNativeChatList(listType, ids) {
    try {
      await ensureWaScriptsInjected();
      const result = await askBridge(
        "chatlist_v350",
        "chatlist_done_v350",
        { listType, ids: ids || [] },
        45000,
      );
      if (!result) throw new Error("O motor do WhatsApp não confirmou o filtro");
    } catch (e) {
      console.warn("[CRM] falha ao aplicar filtro nativo de lista:", e?.message || e);
    }
    ensureNativeTabWatcher();
  }

  function clearChatFilter() {
    activeFilter = null;
    filterLoadingKey = null;
    closeDrawer();
    void applyNativeChatList("all");
    renderTopbar();
  }

  /** Garante que temos contatos/funis em memória antes de filtrar.
   * Sem isso, uma falha pontual de rede deixava o filtro sem dados e a lista
   * aparecia vazia até o usuário recarregar a página. */
  async function ensureFilterData(kind) {
    try {
      if (kind === "label") await loadWaData();
      // Funis: SEMPRE recarrega, não só na primeira vez. Diferente de
      // waData (que fica atualizado por outro caminho), os dados de
      // funnels[] só mudam quando alguém move/adiciona um card no CRM web
      // — se a extensão não recarregar a cada clique, os wa_id ficam
      // desatualizados e o filtro por etapa aplica uma lista vazia,
      // mesmo com contatos reais na etapa.
      if (kind === "stage") await loadFunnels();
    } catch { /* silencioso: o fallback já mostra tudo */ }
  }

  /** Lista (etiqueta do WhatsApp): filtra
   * a lista nativa de conversas pela etiqueta correspondente (inbox do WhatsApp). */
  async function filterByLabel(labelId, labelName) {
    const key = `label:${labelId}`;
    if (activeFilter?.key === key) return clearChatFilter();
    activeFilter = { key, kind: "label", id: labelId, name: labelName || "Lista" };
    renderTopbar();
    closeDrawer();
    await ensureFilterData("label");
    if (activeFilter?.key !== key) return; // usuário trocou de filtro no meio
    const waIds = [...(getActiveFilterWaIds() || [])];
    void applyNativeChatList("custom", waIds);
  }

  /** Etapa de funil: filtra a lista nativa de conversas
   * pelos wa_id correspondentes àquela etapa (inbox do WhatsApp). */
  async function filterByStage(funnelId, stageId) {
    const key = `stage:${stageId}`;
    if (activeFilter?.key === key) return clearChatFilter();
    // Reserva a intenção do clique antes de esperar os dados, com nome
    // provisório — evita que um segundo clique concorrente (usuário troca
    // de etapa rápido) aplique o filtro errado depois do await.
    activeFilter = { key, kind: "stage", id: stageId, funnelId, name: "Etapa", funnelName: "" };
    filterLoadingKey = key;
    renderTopbar();
    closeDrawer();
    await ensureFilterData("stage");
    if (activeFilter?.key !== key) return; // usuário trocou de filtro no meio
    const funnel = funnels.find((f) => f.id === funnelId);
    if (!funnel) { filterLoadingKey = null; renderTopbar(); return; }
    const stage = (funnel.stages || []).find((s) => s.id === stageId);
    activeFilter = {
      key,
      kind: "stage",
      id: stageId,
      funnelId,
      name: stage?.name || "Etapa",
      funnelName: funnel.name,
    };
    renderTopbar();
    // Nem todo card tem wa_contact_id vinculado (ex: lead adicionado pelo
    // CRM antes de o contato sincronizar, ou nunca sincronizou ainda) — sem
    // isso, o card ficava de fora do filtro mesmo contando no total. Cobre
    // esse buraco casando pelo telefone contra o que já sincronizamos.
    const stageCards = (funnel.cards || []).filter((c) => c.stage_id === stageId);
    const waIds = stageCards
      .map((c) => c.wa_id || (waData.contacts || []).find((w) => w.phone && c.phone && w.phone === c.phone)?.wa_id)
      .filter(Boolean);
    if (waIds.length < stageCards.length) {
      console.info(
        `[CRM] Etapa "${stage?.name}": ${stageCards.length} lead(s) no total, ${waIds.length} com conversa do WhatsApp encontrada.`,
      );
    }
    // O motor do WhatsApp pode demorar (ou ainda estar de aquecendo logo
    // após abrir a página) — a pílula fica "carregando" até confirmar,
    // pra não parecer que o clique não registrou.
    await applyNativeChatList("custom", waIds);
    if (filterLoadingKey === key) filterLoadingKey = null;
    renderTopbar();
  }

  // ---------------------------------------------------------------------
  // Gaveta de contatos da lista / etapa selecionada
  // ---------------------------------------------------------------------
  let drawerRef = null;
  let drawerQuery = "";
  let drawerAnchor = null; // Elemento que acionou o drawer

  function closeDrawer() {
    drawerRef?.remove();
    drawerRef = null;
    drawerQuery = "";
    drawerAnchor = null;
  }

  function contactByWaId(waId) {
    if (!waId) return null;
    return (waData.contacts || []).find((c) => c.wa_id === waId) || null;
  }

  /** Contatos do grupo selecionado, já normalizados para a gaveta. */
  function drawerEntries() {
    if (!activeFilter) return [];
    if (activeFilter.kind === "label") {
      return (waData.contacts || [])
        .filter((c) => (c.label_ids || []).map(String).includes(String(activeFilter.id)))
        .map((c) => ({
          wa_id: c.wa_id,
          name: c.name || c.phone || "Contato",
          phone: c.phone || null,
          photo: c.profile_picture_url || null,
          unread: Number(c.unread_count || 0),
          card_id: null,
        }));
    }
    const funnel = funnels.find((f) => f.id === activeFilter.funnelId);
    return ((funnel?.cards) || [])
      .filter((c) => c.stage_id === activeFilter.id)
      .map((c) => {
        const wa = contactByWaId(c.wa_id);
        return {
          wa_id: c.wa_id || null,
          name: c.title || wa?.name || c.phone || "Contato",
          phone: c.phone || wa?.phone || null,
          photo: c.profile_picture_url || wa?.profile_picture_url || null,
          unread: Number(c.unread_count || wa?.unread_count || 0),
          card_id: c.id,
        };
      });
  }

  function initials(name) {
    return String(name || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0])
      .join("")
      .toUpperCase();
  }

  function openDrawer(anchor) {
    if (!drawerRef) {
      const el = document.createElement("div");
      el.id = "crm-drawer";
      el.innerHTML = `
        <div class="crm-dw-head">
          <div>
            <p class="crm-dw-kind"></p>
            <p class="crm-dw-title"></p>
            <p class="crm-dw-sub"></p>
          </div>
          <button class="crm-dw-close" title="Fechar">✕</button>
        </div>
        <input class="crm-dw-search" placeholder="Buscar contato…" />
        <div class="crm-dw-list"></div>
        <div class="crm-dw-foot"><span></span><button data-act="open-crm">Abrir no CRM</button></div>
      `;
      document.body.appendChild(el);
      drawerRef = el;

      el.querySelector(".crm-dw-close").addEventListener("click", () => clearChatFilter());
      el.querySelector(".crm-dw-search").addEventListener("input", (e) => {
        drawerQuery = e.target.value || "";
        renderDrawerList();
      });
      el.querySelector('[data-act="open-crm"]').addEventListener("click", () => {
        if (activeFilter?.kind === "stage") {
          openPainel("funis", `&funnel=${encodeURIComponent(activeFilter.funnelId)}`);
        } else {
          openPainel("funis");
        }
      });
      el.querySelector(".crm-dw-list").addEventListener("click", onDrawerListClick);
    }
    drawerAnchor = anchor;
    renderDrawer();
  }

  function renderDrawer() {
    if (!drawerRef || !activeFilter) return;
    drawerRef.querySelector(".crm-dw-kind").textContent =
      activeFilter.kind === "label" ? "Lista" : `Funil · ${activeFilter.funnelName || ""}`;
    drawerRef.querySelector(".crm-dw-title").textContent = activeFilter.name;
    
    // Posicionar o popover abaixo da aba clicada
    positionDrawer();
    renderDrawerList();
  }

  function positionDrawer() {
    if (!drawerRef) return;
    
    // Encontrar a aba ativa (pill com classe crm-pill-on)
    let anchor = drawerAnchor;
    if (!anchor) {
      anchor = document.querySelector(".crm-pill-on");
    }
    
    if (!anchor) {
      // Fallback: centralizar na tela
      drawerRef.style.top = "50%";
      drawerRef.style.left = "50%";
      drawerRef.style.transform = "translate(-50%, -50%)";
      return;
    }
    
    const rect = anchor.getBoundingClientRect();
    const drawerWidth = 420;
    const drawerHeight = drawerRef.offsetHeight || 600;
    const gap = 10; // espaço entre a aba e o popover
    
    // Posicionar abaixo da aba, centralizado horizontalmente em relação a ela
    let top = rect.bottom + gap;
    let left = rect.left + (rect.width - drawerWidth) / 2;
    
    // Ajustar se sair da tela (horizontal)
    const viewportWidth = window.innerWidth;
    if (left < 8) left = 8;
    if (left + drawerWidth > viewportWidth - 8) left = viewportWidth - drawerWidth - 8;
    
    // Ajustar se sair da tela (vertical)
    const viewportHeight = window.innerHeight;
    if (top + drawerHeight > viewportHeight - 8) {
      // Se não cabe abaixo, tentar acima
      top = rect.top - drawerHeight - gap;
    }
    
    drawerRef.style.top = `${Math.max(8, top)}px`;
    drawerRef.style.left = `${left}px`;
    drawerRef.style.transform = "none";
  }

  function renderDrawerList() {
    if (!drawerRef) return;
    const all = drawerEntries();
    const q = drawerQuery.trim().toLocaleLowerCase("pt-BR");
    const rows = q
      ? all.filter(
          (c) =>
            String(c.name).toLocaleLowerCase("pt-BR").includes(q) ||
            String(c.phone || "").includes(q.replace(/\D/g, "")),
        )
      : all;

    drawerRef.querySelector(".crm-dw-sub").textContent =
      `${all.length} contato${all.length === 1 ? "" : "s"}`;
    drawerRef.querySelector(".crm-dw-foot span").textContent =
      rows.length === all.length ? "Clique num contato para abrir a conversa" : `${rows.length} encontrado(s)`;

    const list = drawerRef.querySelector(".crm-dw-list");
    if (!rows.length) {
      list.innerHTML = `<p class="crm-dw-empty">${
        all.length
          ? "Nenhum contato bate com a busca."
          : activeFilter?.kind === "label"
            ? "Nenhum contato nesta lista ainda. Sincronize as listas no trilho lateral ou marque conversas com esta etiqueta no WhatsApp."
            : "Nenhum contato nesta etapa ainda. Use o botão de funil no cabeçalho da conversa para adicionar."
      }</p>`;
      return;
    }
    list.innerHTML = rows
      .map(
        (c, i) => `<div class="crm-dw-row" data-i="${i}">
          ${
            c.photo
              ? `<img class="crm-dw-avatar" src="${escapeHtml(c.photo)}" alt="" />`
              : `<div class="crm-dw-fallback">${escapeHtml(initials(c.name))}</div>`
          }
          <div class="crm-dw-info">
            <p class="crm-dw-name">${escapeHtml(c.name)}</p>
            <p class="crm-dw-meta">${escapeHtml(c.phone || c.wa_id || "sem telefone")}</p>
          </div>
          ${c.unread ? `<span class="crm-dw-badge">${c.unread > 99 ? "99+" : c.unread}</span>` : ""}
          <button class="crm-dw-more" data-more="${i}" title="Ações">⋯</button>
        </div>`,
      )
      .join("");
    drawerRef.__rows = rows;
  }

  async function onDrawerListClick(e) {
    const rows = drawerRef?.__rows || [];
    const more = e.target.closest("[data-more]");
    if (more) {
      e.stopPropagation();
      const entry = rows[Number(more.getAttribute("data-more"))];
      if (entry) openDrawerRowMenu(more, entry);
      return;
    }
    const row = e.target.closest(".crm-dw-row");
    if (!row) return;
    const entry = rows[Number(row.getAttribute("data-i"))];
    if (entry) void openConversation(entry);
  }

  async function openConversation(entry) {
    const target = entry.phone || String(entry.wa_id || "").split("@")[0];
    if (!target && !entry.wa_id) return crmToast("Contato sem telefone.", "err");
    const res = await handleWaAction({ phone: target, waId: entry.wa_id, openOnly: true });
    if (!res?.ok) crmToast(res?.error || "Não consegui abrir a conversa.", "err");
  }

  function openDrawerRowMenu(anchor, entry) {
    const items = [{ label: "Abrir conversa", onClick: () => void openConversation(entry) }];

    if (activeFilter?.kind === "stage") {
      const funnel = funnels.find((f) => f.id === activeFilter.funnelId);
      for (const st of (funnel?.stages || []).filter((s) => s.id !== activeFilter.id)) {
        items.push({
          label: `Mover para “${st.name}”`,
          onClick: async () => {
            const r = await chrome.runtime
              .sendMessage({
                type: "api",
                path: "/api/public/extension/funnel-cards",
                opts: { method: "PATCH", body: JSON.stringify({ id: entry.card_id, stage_id: st.id }) },
              })
              .catch(() => null);
            if (r?.ok) {
              crmToast(`Movido para ${st.name}`);
              await loadFunnels();
              renderDrawer();
            } else crmToast(r?.error || "Não consegui mover o contato.", "err");
          },
        });
      }
      items.push({
        label: "Remover do funil",
        danger: true,
        onClick: async () => {
          const r = await chrome.runtime
            .sendMessage({
              type: "api",
              path: "/api/public/extension/funnel-cards",
              opts: { method: "DELETE", body: JSON.stringify({ id: entry.card_id }) },
            })
            .catch(() => null);
          if (r?.ok) {
            crmToast("Removido do funil");
            await loadFunnels();
            renderDrawer();
          } else crmToast(r?.error || "Não consegui remover.", "err");
        },
      });
    } else {
      items.push({
        label: "Remover desta lista",
        danger: true,
        onClick: async () => {
          await ensureWaScriptsInjected().catch(() => null);
          const ok = await askBridge("apply_label_v290", "apply_label_done_v290", {
            waId: entry.wa_id,
            labelId: activeFilter.id,
            op: "remove",
          });
          if (ok) {
            crmToast("Removido da lista");
            await syncWaData();
            renderDrawer();
          } else crmToast("Não consegui remover da lista.", "err");
        },
      });
    }
    openMenu(anchor, items);
  }



  function tabFunnel() {
    return funnels.find((f) => f.mode === "tab") || null;
  }

  async function patchStages(funnel, stages) {
    await chrome.runtime
      .sendMessage({
        type: "api",
        path: `/api/public/extension/funnels/${funnel.id}`,
        opts: { method: "PATCH", body: JSON.stringify({ stages }) },
      })
      .catch(() => null);
    loadFunnels();
  }

  /** Popup de mover leads EM MASSA pra essa etapa — escolhe funil + etapa
   * de ORIGEM (qualquer outro funil, não o atual) e move todos os leads
   * de lá pra cá de uma vez. Mesma lógica do CRM (site), só que aqui
   * dentro do WhatsApp, sem precisar abrir o painel. */
  function openBulkMoveLocalPopup(anchor, targetFunnel, targetStage) {
    document.querySelectorAll(".crm-menu, .crm-lite-pop, .crm-cat-filter-pop").forEach((el) => el.remove());
    const pop = document.createElement("div");
    pop.className = "crm-lite-pop crm-bulk-move-pop";
    const rect = anchor.getBoundingClientRect();
    pop.style.top = `${rect.bottom + 8}px`;
    pop.style.left = `${Math.min(Math.max(8, rect.left), window.innerWidth - 280)}px`;
    document.body.appendChild(pop);
    animatePopIn(pop);

    const close = () => {
      pop.remove();
      document.removeEventListener("mousedown", onDoc, true);
    };
    function onDoc(ev) {
      if (!pop.contains(ev.target) && ev.target !== anchor) close();
    }
    setTimeout(() => document.addEventListener("mousedown", onDoc, true), 150);

    const others = funnels.filter((f) => f.id !== targetFunnel.id && f.mode !== "label");
    if (!others.length) {
      pop.innerHTML = `<p class="crm-lite-pop-title">Mover leads para "${escapeHtml(targetStage.name)}"</p><p class="crm-qrp-empty" style="padding:6px 0 0">Você precisa de outro funil pra puxar leads — crie um funil novo primeiro.</p>`;
      return;
    }

    let sourceFunnelId = others[0].id;
    let sourceStageId = others[0].stages?.[0]?.id || "";

    function paint() {
      const sourceFunnel = funnels.find((f) => f.id === sourceFunnelId);
      const count = (sourceFunnel?.cards || []).filter((c) => c.stage_id === sourceStageId).length;
      pop.innerHTML = `
        <p class="crm-lite-pop-title">Mover leads para "${escapeHtml(targetStage.name)}"</p>
        <label class="crm-qrp-meta-field" style="margin-bottom:8px">
          <span>Funil de origem</span>
          <select class="crm-qrp-select" data-bulk-source-funnel>
            ${others.map((f) => `<option value="${escapeHtml(f.id)}" ${f.id === sourceFunnelId ? "selected" : ""}>${escapeHtml(f.name)}</option>`).join("")}
          </select>
        </label>
        <label class="crm-qrp-meta-field" style="margin-bottom:8px">
          <span>Etapa de origem</span>
          <select class="crm-qrp-select" data-bulk-source-stage>
            ${(sourceFunnel?.stages || []).map((s) => `<option value="${escapeHtml(s.id)}" ${s.id === sourceStageId ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
          </select>
        </label>
        <p class="crm-qrp-shortcut-hint">${count === 0 ? "Essa etapa não tem nenhum lead no momento." : `${count} lead${count === 1 ? "" : "s"} ${count === 1 ? "vai" : "vão"} ser movido${count === 1 ? "" : "s"} pra cá.`}</p>
        <button class="crm-lite-pop-confirm" data-bulk-confirm ${count === 0 ? "disabled" : ""}>${count ? `Mover ${count} lead${count === 1 ? "" : "s"}` : "Mover"}</button>
      `;
      pop.querySelector("[data-bulk-source-funnel]").addEventListener("change", (e) => {
        sourceFunnelId = e.target.value;
        const nf = funnels.find((f) => f.id === sourceFunnelId);
        sourceStageId = nf?.stages?.[0]?.id || "";
        paint();
      });
      pop.querySelector("[data-bulk-source-stage]").addEventListener("change", (e) => {
        sourceStageId = e.target.value;
        paint();
      });
      pop.querySelector("[data-bulk-confirm]")?.addEventListener("click", async () => {
        const confirmBtn = pop.querySelector("[data-bulk-confirm]");
        const sourceFunnel = funnels.find((f) => f.id === sourceFunnelId);
        const cardsToMove = (sourceFunnel?.cards || []).filter((c) => c.stage_id === sourceStageId);
        if (!cardsToMove.length) return;
        confirmBtn.disabled = true;
        confirmBtn.textContent = "Movendo...";
        // Sequencial de propósito — evita disparar dezenas de requisições
        // simultâneas se a etapa de origem tiver muitos leads.
        for (const card of cardsToMove) {
          const r = await chrome.runtime
            .sendMessage({
              type: "api",
              path: "/api/public/extension/funnel-cards",
              opts: {
                method: "POST",
                body: JSON.stringify({
                  funnel_id: targetFunnel.id,
                  stage_id: targetStage.id,
                  title: card.title,
                  phone: card.phone || undefined,
                  wa_contact_id: card.wa_contact_id || undefined,
                  wa_id: card.wa_id || undefined,
                }),
              },
            })
            .catch(() => null);
          if (r?.ok) {
            await chrome.runtime
              .sendMessage({ type: "api", path: "/api/public/extension/funnel-cards", opts: { method: "DELETE", body: JSON.stringify({ id: card.id }) } })
              .catch(() => null);
          }
        }
        crmToast(`${cardsToMove.length} lead${cardsToMove.length === 1 ? "" : "s"} movido${cardsToMove.length === 1 ? "" : "s"}`, "ok", anchor);
        close();
        await loadFunnels();
        renderTopbar();
        updateFunnelBadge();
        updateFollowupBadge();
        updateNotesBadge();
        updateScheduleBadge();
      });
    }
    paint();
  }

  function openStageMenu(anchor, funnelId, stageId) {
    const funnel = funnels.find((f) => f.id === funnelId);
    const stage = funnel?.stages?.find((s) => s.id === stageId);
    if (!funnel || !stage) return;
    openMenu(anchor, [
      {
        label: "Mover leads para cá",
        onClick: () => openBulkMoveLocalPopup(anchor, funnel, stage),
      },
      {
        label: "Renomear",
        onClick: async () => {
          const name = await crmPrompt({ title: "Renomear", value: stage.name });
          if (!name) return;
          await patchStages(
            funnel,
            funnel.stages.map((s) => ({
              id: s.id,
              name: s.id === stage.id ? name : s.name,
              sort_order: s.sort_order,
            })),
          );
        },
      },
      {
        label: "Remover",
        danger: true,
        onClick: async () => {
          const ok = await crmConfirm({
            title: `Remover “${stage.name}”?`,
            body: "Os leads dessa etapa serão excluídos.",
            confirmLabel: "Remover",
          });
          if (!ok) return;
          await chrome.runtime
            .sendMessage({
              type: "api",
              path: `/api/public/extension/funnels/${funnel.id}`,
              opts: { method: "PATCH", body: JSON.stringify({ removed_stage_ids: [stage.id] }) },
            })
            .catch(() => null);
          loadFunnels();
        },
      },
    ]);
  }

  async function createTab(anchor) {
    const name = await openInlinePrompt(anchor, { title: "Nova etapa", confirmLabel: "Adicionar" });
    if (!name) return;
    const funnel = currentFunnel();
    if (funnel) {
      await patchStages(funnel, [
        ...funnel.stages.map((s) => ({ id: s.id, name: s.name, sort_order: s.sort_order })),
        { name, sort_order: funnel.stages.length },
      ]);
      return;
    }
    await chrome.runtime
      .sendMessage({
        type: "api",
        path: "/api/public/extension/funnels",
        opts: {
          method: "POST",
          body: JSON.stringify({ name: "FUNIL PRINCIPAL", mode: "tab", stages: [name] }),
        },
      })
      .catch(() => null);
    loadFunnels();
  }

  function renderTopbar() {
    if (!topbarRef) return;

    if (!status.paired) {
      topbarRef.innerHTML = `<span class="crm-topbar-hint">${escapeHtml(
        pairHint || "Zaylo CRM · conectando ao seu WhatsApp…",
      )}</span>`;
      return;
    }

    // Antes era só uma etiqueta fixa ("FUNIL PRINCIPAL"), sem clique —
    // agora é um botão de verdade: clicar abre o seletor de qual funil
    // mostrar aqui (pode ter vários).
    const filter = `<button class="crm-filter crm-filter-picker" data-open-funnel-picker title="Escolher funil">${FILTER_SVG}${escapeHtml(currentFilterLabel())}</button>`;

    const f = currentFunnel();
    const pills = ((f?.stages) || [])
      .map((s) => {
        const cards = (f.cards || []).filter((c) => c.stage_id === s.id);
        const key = `stage:${s.id}`;
        const on = activeFilter?.key === key;
        const loading = filterLoadingKey === key;
        const countHtml = loading
          ? `<span class="crm-pill-count crm-pill-spin"></span>`
          : `<span class="crm-pill-count">${cards.length}</span>`;
        return `<span class="crm-pill${on ? " crm-pill-on" : ""}" data-funnel="${escapeHtml(f.id)}" data-stage="${escapeHtml(s.id)}">
            ${escapeHtml(s.name)}
            ${countHtml}
            <button class="crm-pill-gear" data-funnel="${escapeHtml(f.id)}" data-stage="${escapeHtml(s.id)}" title="Opções">${GEAR_SVG}</button>
          </span>`;
      })
      .join("");

    topbarRef.innerHTML = `${filter}<span class="crm-topbar-divider"></span>${
      pills || `<span class="crm-topbar-hint">Nenhuma etapa nesse funil ainda.</span>`
    }<span class="crm-topbar-divider"></span><button class="crm-pill-add-icon" title="Adicionar nova etapa"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10.5V19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v1.5"/><path d="M17 13v6M14 16h6"/></svg></button>${premiumPill()}${accountPill()}`;
  }

  /** Botão "Minha conta" — fixo na barra do topo, ao lado do aviso de
   * plano, ao invés de dentro do cabeçalho da conversa (que muda toda
   * hora e fica escondido no meio de outros ícones). */
  function accountPill() {
    return `<button class="crm-pill crm-pill-account" data-open-account title="Minha conta">${ICONS.account} Minha conta</button>`;
  }

  /** Aviso de plano vive aqui (no WhatsApp), não mais dentro do painel do CRM. */
  function premiumPill() {
    if (!billing || billing.premium) return "";
    return `<button class="crm-pill crm-pill-premium" data-premium="1" title="Assinar o plano Premium">COMPRAR PREMIUM</button>`;
  }

  async function loadBilling() {
    const r = await chrome.runtime
      .sendMessage({ type: "api", path: "/api/public/extension/billing" })
      .catch(() => null);
    if (r?.ok) {
      billing = r.billing || null;
      renderTopbar();
    }
  }



  // O número logado só aparece no localStorage depois que o WhatsApp Web
  // termina de autenticar. Antes disso o pareamento falha em silêncio e a
  // barra ficava presa em "conectando…" pra sempre. Agora tentamos de novo.
  let pairTimer = null;
  let pairing = false;

  async function attemptPair() {
    if (pairing) return;
    pairing = true;
    try {
      const phone = readLoggedPhone();
      if (!phone) {
        pairHint = "Zaylo CRM · aguardando o WhatsApp Web terminar de carregar…";
        renderTopbar();
        return;
      }
      const res = await chrome.runtime.sendMessage({ type: "pair", phone }).catch(() => null);
      if (res?.ok) {
        pairHint = null;
        stopPairRetry();
        refresh();
        return;
      }
      pairHint = `Zaylo CRM · não consegui vincular: ${res?.error || "sem resposta do servidor"}. Tentando de novo…`;
      renderTopbar();
    } finally {
      pairing = false;
    }
  }

  function startPairRetry() {
    if (pairTimer) return;
    attemptPair();
    pairTimer = setInterval(attemptPair, 5000);
  }

  function stopPairRetry() {
    if (!pairTimer) return;
    clearInterval(pairTimer);
    pairTimer = null;
  }

  async function refresh() {
    const r = await chrome.runtime.sendMessage({ type: "get_status" }).catch(() => null);
    status = r || { paired: false };

    if (!status.paired) {
      stopPollHeartbeat();
      renderTopbar();
      startPairRetry();
      return;
    }

    stopPairRetry();
    renderTopbar();
    // A fila já é consumida pelo service worker. Não fazemos heartbeat nem
    // varredura automática no boot: ambos competiam com o carregamento do WA.
    loadFunnels();
    loadQuickReplies();
    loadQuickReplyCategories();
    loadBilling();
    loadWaData();
  }

  function ensureShell() {
    if (!document.getElementById("crm-rail") || !document.getElementById("crm-topbar")) {
      document.getElementById("crm-rail")?.remove();
      document.getElementById("crm-topbar")?.remove();
      buildShell();
      refresh();
    }
    document.body.classList.add(SHELL_CLASS);
  }

  function startPollHeartbeat() {
    if (pollHeartbeat) return;
    const tick = () => chrome.runtime.sendMessage({ type: "poll_now" }).catch(() => null);
    tick();
    pollHeartbeat = setInterval(tick, 10000);
  }

  function stopPollHeartbeat() {
    if (!pollHeartbeat) return;
    clearInterval(pollHeartbeat);
    pollHeartbeat = null;
  }

  ensureShell();
  ensureChatButton();
  // Não executamos manutenção nem rede enquanto a aba está oculta. Isso evita
  // competir com o ciclo de suspensão/retomada do WhatsApp ao trocar de aba.
  const maintenanceTick = () => {
    if (document.visibilityState !== "visible") return;
    ensureShell();
    ensureChatButton();
  };
  setInterval(maintenanceTick, 8000);
  // Os ícones da conversa precisam aparecer instantaneamente: o React
  // re-renderiza o cabeçalho a cada troca de conversa e esperar o ciclo de 8s
  // dava a impressão de sistema quebrado. Esta varredura é barata
  // (querySelector + contains) e só roda com a aba visível.
  setInterval(() => {
    if (document.visibilityState === "visible") {
      ensureChatButton();
      ensureShortcutListener();
    }
  }, 400);
  // Salvar contato e o Perfil (se aberto) checam a conversa ativa num
  // ciclo mais espaçado — colado no de 400ms, isso ficava chamando a
  // biblioteca do WhatsApp demais (2,5x por segundo, o tempo todo),
  // deixando tudo mais lento sem necessidade.
  setInterval(() => {
    if (document.visibilityState === "visible") {
      void updateSaveContactButton();
      void refreshProfilePanelIfStale();
    }
  }, 1500);
  setInterval(() => {
    if (document.visibilityState === "visible") void loadFunnels();
  }, 300000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    // Só restaura os elementos leves. Nunca reinjeta o motor, sincroniza dados
    // ou chama refresh ao voltar para a aba.
    maintenanceTick();
  });



  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === "crm_content_ping") {
      sendResponse({ ok: true, version: CRM_VERSION });
      return true;
    }
    if (msg?.type === "send_message_v180" || msg?.type === "send_message_v170" || msg?.type === "send_message_v161") {
      handleSend(msg.job)
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
      return true;
    }
    if (msg?.type === "wa_action_v190") {
      handleWaAction(msg.action)
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
      return true;
    }
    if (msg?.type === "show_panel") { ensureShell(); sendResponse({ ok: true }); return true; }
    return false;
  });


  // ---------------------------------------------------------------------
  // Ações dentro da própria conversa do WhatsApp (sem abrir o CRM).
  // Botão "CRM" no cabeçalho da conversa → funis, listas e respostas rápidas.
  // ---------------------------------------------------------------------

  /** Pergunta genérica ao bridge (MAIN world) e espera a resposta. */
  function askBridge(type, doneType, payload = {}, timeoutMs = 30000) {
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      const timeout = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        resolve(null);
      }, timeoutMs);
      function onMessage(ev) {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.__crm !== doneType || d.id !== id) return;
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        resolve(d.ok ? d.data ?? true : null);
      }
      window.addEventListener("message", onMessage);
      window.postMessage({ __crm: type, id, ...payload }, "*");
    });
  }

  /**
   * ID real da conversa aberta, lido do próprio DOM do WhatsApp.
   *
   * As linhas de mensagem carregam data-id="false_<chatId>_<msgId>". É a fonte
   * mais confiável e instantânea: casar pelo nome do cabeçalho falhava sempre
   * que o contato aparecia como "Usuário desconhecido" ou tinha homônimo, e era
   * exatamente isso que gerava o erro "Contato sem telefone".
   */
  function activeChatIdFromDom() {
    const nodes = document.querySelectorAll("#main [data-id]");
    for (const node of nodes) {
      const raw = String(node.getAttribute("data-id") || "");
      const parts = raw.split("_");
      const candidate = parts.length >= 3 ? parts[1] : raw;
      if (/@(c\.us|g\.us|lid|s\.whatsapp\.net)$/.test(candidate)) return candidate;
    }
    return null;
  }

  const CHROME_HEADER_STRINGS = /^(menu|pesquisar|buscar|dados do contato|dados do perfil|informações do contato|informações do perfil|informações do grupo|ver perfil|abrir perfil|chamada de voz|chamada de vídeo|mais opções|anexar|emoji|figurinhas|status)$/i;

  /** Acha o elemento de verdade (não só o texto) onde o WhatsApp mostra o
   * nome/número do contato no cabeçalho — usado tanto pra ler o texto
   * quanto pra plantar o ícone de "salvar contato" bem do ladinho. */
  function headerNameNode() {
    const header = document.querySelector("#main header");
    if (!header) return null;
    const nodes = Array.from(header.querySelectorAll('[title], span[dir="auto"], h1, h2'));
    for (const node of nodes) {
      const value = String(node.getAttribute?.("title") || node.textContent || "").trim();
      if (value && value.length <= 160 && !CHROME_HEADER_STRINGS.test(value)) return node;
    }
    return null;
  }

  function activeChatFromDom() {
    const header = document.querySelector("#main header");
    if (!header) return null;

    // Filtra textos que são da própria interface do WhatsApp (botões do
    // cabeçalho como "Dados do contato", "Pesquisar" etc.) — sem isso, às
    // vezes um desses textos era lido como se fosse o nome do contato.
    const candidates = Array.from(
      header.querySelectorAll('[title], span[dir="auto"], h1, h2'),
    )
      .map((node) => String(node.getAttribute?.("title") || node.textContent || "").trim())
      .filter((value) => value && value.length <= 160 && !CHROME_HEADER_STRINGS.test(value));
    const name = candidates[0] || "Contato";
    const digits = String(header.textContent || "").replace(/\D/g, "");
    const visiblePhone = digits.length >= 10 && digits.length <= 13 ? digits : null;

    const waId = activeChatIdFromDom();
    const normalizedName = name.toLocaleLowerCase("pt-BR");
    const byId = waId ? (waData.contacts || []).find((c) => c.wa_id === waId) : null;
    const matches = (waData.contacts || []).filter(
      (contact) => String(contact.name || "").trim().toLocaleLowerCase("pt-BR") === normalizedName,
    );
    // Cache sincronizada é mais confiável que o texto lido do cabeçalho —
    // prioriza nome/telefone de lá quando o contato já foi sincronizado.
    const cached = byId || (matches.length === 1 ? matches[0] : null);
    return {
      wa_id: waId || cached?.wa_id || null,
      // id interno (uuid) da tabela wa_contacts — é o que a API espera em
      // wa_contact_id, NUNCA o wa_id (que é o identificador do WhatsApp,
      // tipo "5511999999999@c.us", e não passa na validação de uuid).
      contact_db_id: cached?.id || null,
      phone: visiblePhone || cached?.phone || null,
      name: cached?.name || name,
      is_group: (waId || "").endsWith("@g.us") || cached?.is_group || false,
    };
  }



  async function activeChat() {
    // Ler o cabeçalho é instantâneo, mas o NOME que vem de lá é escaneado
    // de qualquer elemento com atributo "title" no cabeçalho — inclusive
    // botões da própria interface do WhatsApp ("Dados do contato", "Dados
    // do perfil", etc.), que mudam de texto entre versões/idiomas do
    // WhatsApp. Isso é frágil por natureza: bloquear string por string
    // (como fizemos antes) só resolve até aparecer a próxima variação.
    //
    // A fonte confiável de nome é: (1) o cache já sincronizado (voltou do
    // ContactStore de verdade, não da tela), ou (2) perguntar pra ponte,
    // que lê resolveName() direto do ContactStore/ChatStore do WhatsApp —
    // não escaneia texto de botões. DOM só decide o wa_id/telefone (rápido)
    // e serve de last-resort se a ponte falhar.
    const dom = activeChatFromDom();

    // Atalho: se o contato já tiver um nome no cache da sincronização,
    // devolve na hora sem esperar a ponte — é o que faz o Perfil e o
    // nome no cabeçalho abrirem instantâneos. is_saved NÃO entra nesse
    // atalho (fica undefined aqui de propósito): esse status muda com
    // frequência e quem precisa dele de verdade (updateSaveContactButton)
    // usa a função dedicada isContactSaved(), não este atalho.
    if (dom?.wa_id) {
      const cached = (waData.contacts || []).find((c) => c.wa_id === dom.wa_id);
      if (cached?.name) {
        return { ...dom, name: cached.name, contact_db_id: cached.id || dom.contact_db_id || null };
      }
    }

    const fromBridge = await askBridge("active_chat_v290", "active_chat_done_v290", { domWaId: dom?.wa_id || null }, 8000);
    if (fromBridge && (fromBridge.wa_id || fromBridge.phone)) {
      const cached = fromBridge.wa_id ? (waData.contacts || []).find((c) => c.wa_id === fromBridge.wa_id) : null;
      return {
        wa_id: fromBridge.wa_id || dom?.wa_id || null,
        contact_db_id: cached?.id || dom?.contact_db_id || null,
        phone: fromBridge.phone || cached?.phone || dom?.phone || null,
        // A ponte lê o nome direto do ContactStore — fonte confiável.
        // Só cai pro nome "de tela" (dom) em último caso.
        name: cached?.name || fromBridge.name || dom?.name || "Contato",
        is_group: !!fromBridge.is_group,
        is_saved: !!fromBridge.is_saved,
        push_name: fromBridge.push_name || null,
      };
    }
    return dom;
  }


  function crmToast(text, kind = "ok", anchor = null) {
    const el = document.createElement("div");
    el.className = `crm-toast${kind === "err" ? " crm-toast-err" : ""}`;
    el.textContent = text;
    if (anchor) {
      // Perto da ação que a gerou (ex: ícone do funil), em vez do aviso
      // genérico lá embaixo no canto da tela.
      const rect = anchor.getBoundingClientRect();
      el.classList.add("crm-toast-anchored");
      el.style.top = `${rect.bottom + 8}px`;
      el.style.left = `${Math.min(Math.max(8, rect.left), window.innerWidth - 260)}px`;
    }
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  const CHAT_BTN_ID = "crm-chat-action";
  const RAIO_BTN_ID = "crm-chat-bolt";
  const NOTES_BTN_ID = "crm-chat-notes";
  const SCHEDULE_BTN_ID = "crm-chat-schedule";
  const PROFILE_BTN_ID = "crm-chat-profile";
  const SAVE_CONTACT_BTN_ID = "crm-chat-save-contact";
  const FOLLOWUP_BTN_ID = "crm-chat-followup";
  const BOLT_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg>`;
  const PROFILE_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3.5" width="18" height="17" rx="3.2"/><circle cx="12" cy="10" r="3"/><path d="M6.5 17.2c.9-2.3 3-3.7 5.5-3.7s4.6 1.4 5.5 3.7"/></svg>`;
  // Pessoa com "+" — aparece só quando o contato ainda não está salvo na
  // agenda de quem está usando o WhatsApp (ver is_saved em activeChat()).
  const SAVE_CONTACT_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.3"/><path d="M3.2 19c.9-3.1 3.1-4.8 5.8-4.8"/><path d="M18 8v6M15 11h6"/></svg>`;
  const DEAL_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9v.01M18 15v.01"/></svg>`;
  const NOTES_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3.3A1.3 1.3 0 0 1 10.3 2h3.4A1.3 1.3 0 0 1 15 3.3V4"/><path d="m10 17 6.2-6.2a1.15 1.15 0 0 0-1.6-1.6L8.4 15.4l-.5 2.1z"/></svg>`;
  const SCHEDULE_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5h11"/><path d="M14.5 4.5H5.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10"/><path d="M8 3v3M12 3v3"/><circle cx="16.5" cy="15.5" r="5"/><path d="M16.5 13v2.5l1.7 1"/></svg>`;

  function formatDateTime(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch {
      return iso;
    }
  }

  /** Diálogo centralizado — Anotações e Mensagens agendadas. Flutua no meio
   * da tela sem escurecer/desfocar o resto (sensação nativa). Clicar fora
   * fecha. */
  function openCenteredDialog() {
    document.querySelectorAll(".crm-dialog-overlay").forEach((el) => el.remove());
    const overlay = document.createElement("div");
    overlay.className = "crm-dialog-overlay";
    const dialog = document.createElement("div");
    dialog.className = "crm-dialog";
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add("is-in")));
    const close = () => overlay.remove();
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close();
    });
    return { overlay, dialog, close };
  }

  // ---------------------------------------------------------------------
  // Anotações — múltiplas notas por lead, com texto e/ou mídia anexada.
  // ---------------------------------------------------------------------
  // Pré-carrega no hover — quando o clique realmente acontece, os dados já
  // estão prontos e o diálogo abre com o conteúdo final na hora, sem
  // nenhum estado de "carregando" perceptível.
  let notesPrefetch = null; // { key, notes }
  let schedulePrefetch = null; // { key, jobs }

  async function prefetchNotes() {
    const chat = await activeChat();
    const contactQuery = contactIdentityQuery(chat?.contact_db_id, chat?.phone);
    if (!contactQuery) return;
    const r = await chrome.runtime
      .sendMessage({ type: "api", path: `/api/public/extension/lead-notes?${contactQuery}` })
      .catch(() => null);
    notesPrefetch = { key: contactQuery, chat, notes: r?.ok ? r.notes || [] : [] };
  }

  async function prefetchSchedule() {
    const chat = await activeChat();
    // Segue o mesmo padrão de prefetchNotes: telefone quando dá, id
    // interno como reforço/alternativa (contato sem telefone visível no
    // cabeçalho da conversa, por exemplo).
    const contactQuery = contactIdentityQuery(chat?.contact_db_id, chat?.phone);
    if (!contactQuery) return;
    const r = await chrome.runtime
      .sendMessage({ type: "api", path: `/api/public/extension/lead-schedule?${contactQuery}` })
      .catch(() => null);
    schedulePrefetch = { key: contactQuery, chat, jobs: r?.ok ? r.jobs || [] : [] };
  }

  async function openNotesDialog() {
    const { dialog, close } = openCenteredDialog();
    // Garante que o navegador já desenhou o diálogo antes de começar
    // qualquer trabalho assíncrono — abre na hora, sem sensação de travar.
    await new Promise((r) => requestAnimationFrame(r));
    const chat = await activeChat();
    const contactQuery = contactIdentityQuery(chat?.contact_db_id, chat?.phone);
    let uploaded = null;
    let currentNotes = [];
    let editingNoteId = null;

    function head(title) {
      return `<div class="crm-dialog-head"><p class="crm-dialog-title">${title}</p><button class="crm-dialog-close" data-close title="Fechar">&times;</button></div>`;
    }

    function renderList(notes) {
      currentNotes = notes;
      if (!notes.length) {
        dialog.innerHTML = `
          ${head("Anotações")}
          <div class="crm-dialog-body">
            <div class="crm-dialog-empty">
              <div class="crm-dialog-empty-icon">${NOTES_SVG}</div>
              <p class="crm-dialog-empty-title">Nenhuma nota encontrada</p>
              <p class="crm-dialog-empty-text">Parece que você ainda não adicionou nenhuma nota. Clique no botão abaixo para criar uma nova nota.</p>
              <button class="crm-dialog-cta" data-new>Criar anotação</button>
            </div>
          </div>
        `;
        return;
      }
      dialog.innerHTML = `
        ${head("Anotações")}
        <div class="crm-dialog-body">
          <div class="crm-dialog-list-head">
            <h4>${notes.length} nota${notes.length === 1 ? "" : "s"}</h4>
            <button class="crm-dialog-cta" data-new>+ Nova</button>
          </div>
          <div class="crm-dialog-list">
            ${notes
              .map((n) => {
                const mime = n.media_mime || "";
                const media = !n.media_url
                  ? ""
                  : /^image\//.test(mime)
                    ? `<img src="${escapeHtml(n.media_url)}" class="crm-dialog-item-media" alt="" />`
                    : /^video\//.test(mime)
                      ? `<video src="${escapeHtml(n.media_url)}" class="crm-dialog-item-media" controls></video>`
                      : /^audio\//.test(mime)
                        ? `<audio src="${escapeHtml(n.media_url)}" class="crm-qrp-preview-audio" controls></audio>`
                        : "";
                return `
                <div class="crm-dialog-item">
                  <div class="crm-dialog-item-head">
                    <p class="crm-dialog-item-meta">${formatDateTime(n.created_at)}</p>
                    <div style="display:flex;gap:2px">
                      <button class="crm-dialog-item-del" data-edit="${escapeHtml(n.id)}" title="Editar">${PENCIL_SVG}</button>
                      <button class="crm-dialog-item-del" data-del="${escapeHtml(n.id)}" title="Excluir">${TRASH_SVG}</button>
                    </div>
                  </div>
                  ${n.body ? `<p class="crm-dialog-item-body">${escapeHtml(n.body)}</p>` : ""}
                  ${media}
                </div>`;
              })
              .join("")}
          </div>
        </div>
      `;
    }

    function renderForm(note) {
      editingNoteId = note?.id || null;
      uploaded = note?.media_path ? { path: note.media_path, mime: note.media_mime, filename: note.media_filename } : null;
      dialog.innerHTML = `
        ${head(editingNoteId ? "Editar anotação" : "Criar anotação")}
        <div class="crm-dialog-body">
          <label class="crm-dialog-field">
            <span>Adicione uma mídia na anotação</span>
            <div class="crm-dialog-dropzone${uploaded ? " has-file" : ""}" data-pick-file>${uploaded ? `Anexado: ${escapeHtml(uploaded.filename || "")}` : "Clique para escolher um arquivo (imagem, áudio ou vídeo)"}</div>
            <input type="file" accept="image/*,audio/*,video/*" data-file-input hidden />
          </label>
          <label class="crm-dialog-field">
            <span>Insira uma anotação</span>
            <textarea class="crm-dialog-textarea" data-note-body placeholder="Escreva sua nota...">${escapeHtml(note?.body || "")}</textarea>
          </label>
          <div class="crm-dialog-foot">
            <button class="crm-dialog-cta-ghost" data-back>Cancelar</button>
            <button class="crm-dialog-cta" data-save>Salvar</button>
          </div>
        </div>
      `;
    }

    async function loadList() {
      if (!contactQuery) {
        dialog.innerHTML = `${head("Anotações")}<div class="crm-dialog-body"><p class="crm-fn-pop-empty">Não consegui identificar essa conversa.</p></div>`;
        return;
      }
      // Já pré-carregado no hover do ícone — mostra na hora, sem "Carregando".
      if (notesPrefetch && notesPrefetch.key === contactQuery) {
        renderList(notesPrefetch.notes);
        // Atualiza por trás, silenciosamente, caso tenha mudado.
        chrome.runtime
          .sendMessage({ type: "api", path: `/api/public/extension/lead-notes?${contactQuery}` })
          .then((r) => {
            if (r?.ok) {
              // Atualiza o cache também — é ele que alimenta o selinho no
              // ícone, senão o número só mudaria na próxima troca de
              // conversa, não na hora que a nota é salva.
              notesPrefetch = { key: contactQuery, chat, notes: r.notes || [] };
              updateNotesBadge();
              if (dialog.isConnected) renderList(r.notes || []);
            }
          })
          .catch(() => null);
        return;
      }
      dialog.innerHTML = `${head("Anotações")}<div class="crm-dialog-body"><p class="crm-fn-pop-empty">Carregando...</p></div>`;
      const r = await chrome.runtime
        .sendMessage({ type: "api", path: `/api/public/extension/lead-notes?${contactQuery}` })
        .catch(() => null);
      const notes = r?.ok ? r.notes || [] : [];
      notesPrefetch = { key: contactQuery, chat, notes };
      updateNotesBadge();
      renderList(notes);
    }

    dialog.addEventListener("click", async (e) => {
      if (e.target.closest("[data-close]")) return close();
      if (e.target.closest("[data-new]")) return renderForm(null);
      if (e.target.closest("[data-back]")) return loadList();
      if (e.target.closest("[data-pick-file]")) return dialog.querySelector("[data-file-input]")?.click();

      const editBtn = e.target.closest("[data-edit]");
      if (editBtn) {
        const note = currentNotes.find((n) => n.id === editBtn.getAttribute("data-edit"));
        if (note) return renderForm(note);
        return;
      }

      const del = e.target.closest("[data-del]");
      if (del) {
        const id = del.getAttribute("data-del");
        await chrome.runtime
          .sendMessage({ type: "api", path: `/api/public/extension/lead-notes/${id}`, opts: { method: "DELETE" } })
          .catch(() => null);
        return loadList();
      }

      if (e.target.closest("[data-save]")) {
        const saveBtn = dialog.querySelector("[data-save]");
        const bodyText = dialog.querySelector("[data-note-body]").value.trim();
        if (!bodyText && !uploaded) {
          crmToast("Escreva algo ou anexe um arquivo.", "err");
          return;
        }
        if (!contactQuery) return;
        saveBtn.disabled = true;
        saveBtn.textContent = "Salvando...";
        const r = editingNoteId
          ? await chrome.runtime
              .sendMessage({
                type: "api",
                path: `/api/public/extension/lead-notes/${editingNoteId}`,
                opts: {
                  method: "PATCH",
                  body: JSON.stringify({
                    body: bodyText || null,
                    media_path: uploaded?.path || null,
                    media_mime: uploaded?.mime || null,
                    media_filename: uploaded?.filename || null,
                  }),
                },
              })
              .catch(() => null)
          : await chrome.runtime
              .sendMessage({
                type: "api",
                path: "/api/public/extension/lead-notes",
                opts: {
                  method: "POST",
                  body: JSON.stringify({
                    wa_contact_id: chat.contact_db_id || null,
                    phone: chat.phone || null,
                    body: bodyText || null,
                    media_path: uploaded?.path || null,
                    media_mime: uploaded?.mime || null,
                    media_filename: uploaded?.filename || null,
                  }),
                },
              })
              .catch(() => null);
        if (r?.ok) {
          crmToast(editingNoteId ? "Anotação atualizada" : "Anotação salva");
          await loadList();
        } else {
          crmToast(r?.error || "Não consegui salvar.", "err");
          saveBtn.disabled = false;
          saveBtn.textContent = "Salvar";
        }
      }
    });

    dialog.addEventListener("change", async (e) => {
      const fileInput = e.target.closest("[data-file-input]");
      if (!fileInput) return;
      const file = fileInput.files?.[0];
      if (!file) return;
      const zone = dialog.querySelector("[data-pick-file]");
      zone.textContent = "Enviando...";
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
          reader.readAsDataURL(file);
        });
        const r = await chrome.runtime
          .sendMessage({
            type: "api",
            path: "/api/public/extension/quick-replies/upload",
            opts: { method: "POST", body: JSON.stringify({ filename: file.name, mime: file.type, data_base64: dataUrl }) },
          })
          .catch(() => null);
        if (r?.ok) {
          uploaded = { path: r.path, mime: r.mime, filename: r.filename };
          zone.textContent = `Anexado: ${r.filename}`;
          zone.classList.add("has-file");
        } else {
          crmToast(r?.error || "Não consegui enviar o arquivo.", "err");
          zone.textContent = "Clique para escolher um arquivo (imagem, áudio ou vídeo)";
        }
      } catch (err) {
        crmToast(err?.message || "Erro ao ler arquivo", "err");
      }
    });

    await loadList();
  }

  // ---------------------------------------------------------------------
  // Mensagens agendadas — reaproveita a fila de envio (message_jobs) já
  // usada pelo agendamento dentro do funil, só que direto pelo contato.
  // ---------------------------------------------------------------------
  async function openScheduleDialog() {
    const { dialog, close } = openCenteredDialog();
    await new Promise((r) => requestAnimationFrame(r));
    const chat = await activeChat();

    function head(title) {
      return `<div class="crm-dialog-head"><p class="crm-dialog-title">${title}</p><button class="crm-dialog-close" data-close title="Fechar">&times;</button></div>`;
    }
    function statusBadge(job) {
      if (job.status === "sent") return `<span class="crm-dialog-badge crm-dialog-badge-sent">Enviada</span>`;
      if (job.status === "failed") return `<span class="crm-dialog-badge crm-dialog-badge-failed">Falhou</span>`;
      return `<span class="crm-dialog-badge crm-dialog-badge-pending">Agendada</span>`;
    }

    let currentJobs = [];
    let editingJobId = null;
    let formType = "text"; // text | image | audio | qr
    let formUploaded = null; // { path, mime, filename }
    let formQrId = null;

    function mediaPreviewHtml(action) {
      if (!action?.url) return "";
      if (/^image\//.test(action.mime || "")) return `<img src="${escapeHtml(action.url)}" class="crm-dialog-item-media" alt="" />`;
      if (/^video\//.test(action.mime || "")) return `<video src="${escapeHtml(action.url)}" class="crm-dialog-item-media" controls></video>`;
      if (/^audio\//.test(action.mime || "")) return `<audio src="${escapeHtml(action.url)}" class="crm-qrp-preview-audio" controls></audio>`;
      return "";
    }

    function renderList(jobs) {
      currentJobs = jobs;
      if (!jobs.length) {
        dialog.innerHTML = `
          ${head("Mensagens agendadas")}
          <div class="crm-dialog-body">
            <div class="crm-dialog-empty">
              <div class="crm-dialog-empty-icon">${SCHEDULE_SVG}</div>
              <p class="crm-dialog-empty-title">Nenhum agendamento encontrado</p>
              <p class="crm-dialog-empty-text">Não há agendamentos programados no momento. Para adicionar um novo, clique no botão de criação.</p>
              <button class="crm-dialog-cta" data-new>Adicionar</button>
            </div>
          </div>
        `;
        return;
      }
      dialog.innerHTML = `
        ${head("Mensagens agendadas")}
        <div class="crm-dialog-body">
          <div class="crm-dialog-list-head">
            <h4>${jobs.length} agendamento${jobs.length === 1 ? "" : "s"}</h4>
            <button class="crm-dialog-cta" data-new>+ Novo</button>
          </div>
          <div class="crm-dialog-list">
            ${jobs
              .map((j) => {
                const mediaActions = (j.message_actions || []).filter((a) => a.type !== "text" && a.url);
                return `
              <div class="crm-dialog-item">
                <div class="crm-dialog-item-head">
                  <p class="crm-dialog-item-meta">${formatDateTime(j.scheduled_for)}${statusBadge(j)}</p>
                  <div style="display:flex;gap:2px">
                    ${j.status === "pending" ? `<button class="crm-dialog-item-del" data-edit="${escapeHtml(j.id)}" title="Editar">${PENCIL_SVG}</button>` : ""}
                    <button class="crm-dialog-item-del" data-cancel="${escapeHtml(j.id)}" title="${j.status === "pending" ? "Cancelar" : "Excluir"}">${TRASH_SVG}</button>
                  </div>
                </div>
                <p class="crm-dialog-item-body">${escapeHtml(j.rendered_body)}</p>
                ${mediaActions.map(mediaPreviewHtml).join("")}
                ${j.status === "failed" && j.last_error ? `<p class="crm-dialog-item-meta" style="color:var(--z-danger)">${escapeHtml(j.last_error)}</p>` : ""}
              </div>`;
              })
              .join("")}
          </div>
        </div>
      `;
    }

    function typeTabsHtml() {
      const tabs = [
        { key: "text", label: "Texto" },
        { key: "image", label: "Imagem" },
        { key: "audio", label: "Áudio" },
        { key: "qr", label: "Resposta rápida" },
      ];
      return `<div class="crm-qrp-switcher" style="border-radius:10px;border:1px solid var(--z-line-soft);margin-bottom:14px">
        ${tabs.map((t) => `<button type="button" class="crm-qrp-switch-btn${formType === t.key ? " is-active" : ""}" data-type-tab="${t.key}" style="font-size:11.5px;font-weight:700">${t.label}</button>`).join("")}
      </div>`;
    }

    async function typeBodyHtml() {
      if (formType === "text") {
        return `<label class="crm-dialog-field"><span>Mensagem</span><textarea class="crm-dialog-textarea" data-msg placeholder="Digite a mensagem que será enviada...">${escapeHtml(formPrefillText || "")}</textarea></label>`;
      }
      if (formType === "image" || formType === "audio") {
        const label = formType === "image" ? "imagem" : "áudio";
        return `
          <label class="crm-dialog-field">
            <span>Arquivo (${label})</span>
            <div class="crm-dialog-dropzone${formUploaded ? " has-file" : ""}" data-pick-file>${formUploaded ? `Anexado: ${escapeHtml(formUploaded.filename || "")}` : `Clique para escolher um arquivo de ${label}`}</div>
            <input type="file" accept="${formType}/*" data-file-input hidden />
          </label>
          ${formType === "image" ? `<label class="crm-dialog-field"><span>Legenda (opcional)</span><input class="crm-dialog-input" data-caption /></label>` : ""}
        `;
      }
      // qr
      if (!quickReplies.length) await loadQuickReplies();
      return `
        <label class="crm-dialog-field">
          <span>Resposta rápida</span>
          <select class="crm-dialog-select" data-qr-pick>
            <option value="">Escolha uma resposta rápida...</option>
            ${quickReplies.map((q) => `<option value="${escapeHtml(q.id)}" ${formQrId === q.id ? "selected" : ""}>${escapeHtml(q.title)}</option>`).join("")}
          </select>
        </label>
        ${!quickReplies.length ? `<p class="crm-fn-pop-empty">Nenhuma resposta rápida cadastrada ainda.</p>` : ""}
      `;
    }

    let formPrefillText = "";

    async function renderForm(job) {
      editingJobId = job?.id || null;
      formUploaded = null;
      formQrId = null;
      formPrefillText = job?.rendered_body || "";
      formType = "text";
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const minDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const jobDate = job ? new Date(job.scheduled_for) : null;
      dialog.innerHTML = `
        ${head(editingJobId ? "Editar agendamento" : "Criar agendamento")}
        <div class="crm-dialog-body">
          ${typeTabsHtml()}
          <div data-type-body>${await typeBodyHtml()}</div>
          <div class="crm-dialog-row2">
            <label class="crm-dialog-field"><span>Data</span><input type="date" class="crm-dialog-input" data-date min="${minDate}" value="${jobDate ? jobDate.toISOString().slice(0, 10) : ""}" /></label>
            <label class="crm-dialog-field"><span>Hora</span><input type="time" class="crm-dialog-input" data-time value="${jobDate ? jobDate.toTimeString().slice(0, 5) : ""}" /></label>
          </div>
          <div class="crm-dialog-foot">
            <button class="crm-dialog-cta-ghost" data-back>Cancelar</button>
            <button class="crm-dialog-cta" data-save>${editingJobId ? "Salvar" : "Criar"}</button>
          </div>
        </div>
      `;
    }

    async function refreshTypeBody() {
      const el = dialog.querySelector("[data-type-body]");
      if (el) el.innerHTML = await typeBodyHtml();
      dialog.querySelectorAll("[data-type-tab]").forEach((b) => {
        b.classList.toggle("is-active", b.getAttribute("data-type-tab") === formType);
      });
    }

    async function loadList() {
      const contactQuery = contactIdentityQuery(chat?.contact_db_id, chat?.phone);
      if (!contactQuery) {
        dialog.innerHTML = `${head("Mensagens agendadas")}<div class="crm-dialog-body"><p class="crm-fn-pop-empty">Não consegui identificar essa conversa.</p></div>`;
        return;
      }
      // Já pré-carregado no hover do ícone — mostra na hora, sem "Carregando".
      if (schedulePrefetch && schedulePrefetch.key === contactQuery) {
        renderList(schedulePrefetch.jobs);
        chrome.runtime
          .sendMessage({ type: "api", path: `/api/public/extension/lead-schedule?${contactQuery}` })
          .then((r) => {
            if (r?.ok) {
              // Atualiza o cache também — é ele que alimenta o selinho no
              // ícone, senão o número só mudaria na próxima troca de
              // conversa, não na hora que o agendamento é criado.
              schedulePrefetch = { key: contactQuery, chat, jobs: r.jobs || [] };
              updateScheduleBadge();
              if (dialog.isConnected) renderList(r.jobs || []);
            }
          })
          .catch(() => null);
        return;
      }
      dialog.innerHTML = `${head("Mensagens agendadas")}<div class="crm-dialog-body"><p class="crm-fn-pop-empty">Carregando...</p></div>`;
      const r = await chrome.runtime
        .sendMessage({ type: "api", path: `/api/public/extension/lead-schedule?${contactQuery}` })
        .catch(() => null);
      const jobs = r?.ok ? r.jobs || [] : [];
      schedulePrefetch = { key: contactQuery, chat, jobs };
      updateScheduleBadge();
      renderList(jobs);
    }

    dialog.addEventListener("click", async (e) => {
      if (e.target.closest("[data-close]")) return close();
      if (e.target.closest("[data-new]")) return renderForm(null);
      if (e.target.closest("[data-back]")) return loadList();
      if (e.target.closest("[data-pick-file]")) return dialog.querySelector("[data-file-input]")?.click();

      const typeTab = e.target.closest("[data-type-tab]");
      if (typeTab) {
        formType = typeTab.getAttribute("data-type-tab");
        formUploaded = null;
        return void refreshTypeBody();
      }

      const editBtn = e.target.closest("[data-edit]");
      if (editBtn) {
        const job = currentJobs.find((j) => j.id === editBtn.getAttribute("data-edit"));
        if (job) return renderForm(job);
        return;
      }

      const cancel = e.target.closest("[data-cancel]");
      if (cancel) {
        const id = cancel.getAttribute("data-cancel");
        await chrome.runtime
          .sendMessage({ type: "api", path: `/api/public/extension/lead-schedule/${id}`, opts: { method: "DELETE" } })
          .catch(() => null);
        return loadList();
      }

      if (e.target.closest("[data-save]")) {
        const saveBtn = dialog.querySelector("[data-save]");
        const date = dialog.querySelector("[data-date]").value;
        const time = dialog.querySelector("[data-time]").value;
        if (!chat?.phone) {
          crmToast("Esse contato não tem telefone identificado.", "err");
          return;
        }
        let scheduledFor;
        if (date && time) {
          const parsedDate = new Date(`${date}T${time}:00`);
          if (Number.isNaN(parsedDate.getTime())) {
            crmToast("Data ou hora inválida.", "err");
            return;
          }
          scheduledFor = parsedDate.toISOString();
        }

        let body;
        if (formType === "text") {
          const msg = dialog.querySelector("[data-msg]")?.value.trim();
          if (!msg) { crmToast("Escreva a mensagem.", "err"); return; }
          body = { message: msg };
        } else if (formType === "image" || formType === "audio") {
          if (!formUploaded) { crmToast("Escolha um arquivo.", "err"); return; }
          const caption = dialog.querySelector("[data-caption]")?.value.trim() || undefined;
          body = { actions: [{ type: formType, path: formUploaded.path, mime: formUploaded.mime, filename: formUploaded.filename, caption }] };
        } else {
          const qrId = dialog.querySelector("[data-qr-pick]")?.value;
          if (!qrId) { crmToast("Escolha uma resposta rápida.", "err"); return; }
          const qr = quickReplies.find((q) => q.id === qrId);
          if (!qr) { crmToast("Resposta rápida não encontrada.", "err"); return; }
          body = { actions: qr.actions.filter((a) => ["text", "image", "audio", "video"].includes(a.type)) };
        }

        saveBtn.disabled = true;
        saveBtn.textContent = editingJobId ? "Salvando..." : "Criando...";
        const r = editingJobId
          ? await chrome.runtime
              .sendMessage({
                type: "api",
                path: `/api/public/extension/lead-schedule/${editingJobId}`,
                opts: { method: "PATCH", body: JSON.stringify({ ...body, scheduled_for: scheduledFor }) },
              })
              .catch(() => null)
          : await chrome.runtime
              .sendMessage({
                type: "api",
                path: "/api/public/extension/lead-schedule",
                opts: {
                  method: "POST",
                  body: JSON.stringify({
                    wa_contact_id: chat.contact_db_id || null,
                    phone: chat.phone,
                    name: chat.name || null,
                    scheduled_for: scheduledFor,
                    ...body,
                  }),
                },
              })
              .catch(() => null);
        if (r?.ok) {
          crmToast(editingJobId ? "Agendamento atualizado" : "Mensagem agendada");
          await loadList();
        } else {
          crmToast(r?.error || "Não consegui agendar.", "err");
          saveBtn.disabled = false;
          saveBtn.textContent = editingJobId ? "Salvar" : "Criar";
        }
      }
    });

    dialog.addEventListener("change", async (e) => {
      const fileInput = e.target.closest("[data-file-input]");
      if (fileInput) {
        const file = fileInput.files?.[0];
        if (!file) return;
        const zone = dialog.querySelector("[data-pick-file]");
        zone.textContent = "Enviando...";
        try {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
            reader.readAsDataURL(file);
          });
          const r = await chrome.runtime
            .sendMessage({
              type: "api",
              path: "/api/public/extension/quick-replies/upload",
              opts: { method: "POST", body: JSON.stringify({ filename: file.name, mime: file.type, data_base64: dataUrl }) },
            })
            .catch(() => null);
          if (r?.ok) {
            formUploaded = { path: r.path, mime: r.mime, filename: r.filename };
            zone.textContent = `Anexado: ${r.filename}`;
            zone.classList.add("has-file");
          } else {
            crmToast(r?.error || "Não consegui enviar o arquivo.", "err");
          }
        } catch (err) {
          crmToast(err?.message || "Erro ao ler arquivo", "err");
        }
        return;
      }
      if (e.target.closest("[data-qr-pick]")) {
        formQrId = e.target.value || null;
      }
    });

    await loadList();
  }





  /**
   * O cabeçalho da conversa é re-renderizado pelo React o tempo todo, e o
   * <header> raiz não é flex container em todas as builds. Por isso o botão é
   * colocado dentro da barra de ícones da direita (menu/busca) quando existe,
   * com fallback para o próprio header.
   */
  function headerActionsSlot(header) {
    const known =
      header.querySelector('[data-testid="conversation-menu-button"]') ||
      header.querySelector('[data-icon="menu"]') ||
      header.querySelector('[data-icon="search"]') ||
      header.querySelector('[aria-label="Menu"]');
    let node = known;
    while (node && node !== header) {
      if (node.parentElement === header) return node;
      node = node.parentElement;
    }
    return header.lastElementChild || header;
  }

  function ensureChatButton() {
    const header = document.querySelector("#main header");
    if (!header) return;
    const hasCrm = document.getElementById(CHAT_BTN_ID);
    const hasBolt = document.getElementById(RAIO_BTN_ID);
    const hasNotes = document.getElementById(NOTES_BTN_ID);
    const hasSchedule = document.getElementById(SCHEDULE_BTN_ID);
    const hasProfile = document.getElementById(PROFILE_BTN_ID);
    const hasSaveContact = document.getElementById(SAVE_CONTACT_BTN_ID);
    const hasFollowup = document.getElementById(FOLLOWUP_BTN_ID);
    if (
      hasCrm && hasBolt && hasNotes && hasSchedule && hasProfile && hasSaveContact && hasFollowup &&
      header.contains(hasCrm) && header.contains(hasBolt) && header.contains(hasNotes) && header.contains(hasSchedule) && header.contains(hasProfile) && header.contains(hasSaveContact) && header.contains(hasFollowup)
    ) {
      updateFunnelBadge();
      updateFollowupBadge();
      updateNotesBadge();
      updateScheduleBadge();
      return;
    }
    hasCrm?.remove();
    hasBolt?.remove();
    hasNotes?.remove();
    hasSchedule?.remove();
    hasProfile?.remove();
    hasSaveContact?.remove();
    hasFollowup?.remove();

    const btn = document.createElement("button");
    btn.id = CHAT_BTN_ID;
    btn.type = "button";
    btn.setAttribute("data-label", "Funis de vendas");
    btn.className = "crm-chat-btn crm-chat-btn-icon";
    btn.innerHTML = ICONS.funnel;
    btn.addEventListener("mouseenter", prewarmEngine);
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Independente do painel grande — popover leve ancorado, como
      // sempre foi.
      if (document.querySelector(".crm-fn-pop")) {
        document.querySelector(".crm-fn-pop")?.remove();
        return;
      }
      openFunnelPopover(btn);
    });

    // Notas e Mensagens agendadas — dois ícones novos, colados no funil.
    const notesBtn = document.createElement("button");
    notesBtn.id = NOTES_BTN_ID;
    notesBtn.className = "crm-chat-btn crm-chat-btn-icon";
    notesBtn.type = "button";
    notesBtn.setAttribute("data-label", "Anotações");
    notesBtn.innerHTML = NOTES_SVG;
    notesBtn.addEventListener("mouseenter", prefetchNotes);
    notesBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void openNotesDialog();
    });

    const scheduleBtn = document.createElement("button");
    scheduleBtn.id = SCHEDULE_BTN_ID;
    scheduleBtn.className = "crm-chat-btn crm-chat-btn-icon";
    scheduleBtn.type = "button";
    scheduleBtn.setAttribute("data-label", "Mensagens agendadas");
    scheduleBtn.innerHTML = SCHEDULE_SVG;
    scheduleBtn.addEventListener("mouseenter", prefetchSchedule);
    scheduleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void openScheduleDialog();
    });

    // Só um segundo botão na conversa agora: o raio. Ele é a porta de
    // entrada do painel grande, que já nasce mostrando Respostas rápidas
    // — dentro dele tem os 3 ícones (raio/perfil/valor) pra trocar sem
    // fechar nada. Fica colado no menu de 3 pontinhos do WhatsApp.
    const boltBtn = document.createElement("button");
    boltBtn.id = RAIO_BTN_ID;
    boltBtn.className = "crm-chat-btn crm-chat-btn-icon";
    boltBtn.type = "button";
    boltBtn.setAttribute("data-label", "Respostas rápidas");
    boltBtn.innerHTML = BOLT_SVG;
    boltBtn.addEventListener("mouseenter", prewarmEngine);
    boltBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void openSharedPanel("qr");
    });

    // Perfil do cliente — ícone próprio, cai direto na aba certa dentro
    // do painel compartilhado (antes só dava pra chegar lá pelo raio).
    const profileBtn = document.createElement("button");
    profileBtn.id = PROFILE_BTN_ID;
    profileBtn.className = "crm-chat-btn crm-chat-btn-icon";
    profileBtn.type = "button";
    profileBtn.setAttribute("data-label", "Perfil do cliente");
    profileBtn.innerHTML = PROFILE_SVG;
    profileBtn.addEventListener("mouseenter", prewarmEngine);
    profileBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void openSharedPanel("profile");
    });

    // Salvar contato — só fica visível quando o contato ainda não está
    // salvo (updateSaveContactButton cuida de mostrar/esconder).
    const saveContactBtn = document.createElement("button");
    saveContactBtn.id = SAVE_CONTACT_BTN_ID;
    // Classe própria — não é mais um dos 5 ícones da fileira, fica
    // pequeno e alinhado com o texto do nome/número, do ladinho dele.
    saveContactBtn.className = "crm-save-contact-badge";
    saveContactBtn.type = "button";
    saveContactBtn.style.display = "none";
    saveContactBtn.setAttribute("data-label", "Salvar contato");
    saveContactBtn.innerHTML = SAVE_CONTACT_SVG;
    saveContactBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void saveActiveContact(saveContactBtn);
    });

    const followupBtn = document.createElement("button");
    followupBtn.id = FOLLOWUP_BTN_ID;
    followupBtn.type = "button";
    followupBtn.className = "crm-chat-btn crm-chat-btn-icon";
    followupBtn.style.display = "none"; // só aparece se esse contato estiver numa etapa com follow-up
    followupBtn.setAttribute("data-label", "Follow-up");
    followupBtn.innerHTML = ICONS.clock;
    followupBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (document.querySelector(".crm-followup-pop")) {
        document.querySelector(".crm-followup-pop")?.remove();
        return;
      }
      openFollowupStatusPopover(followupBtn);
    });

    const slot = headerActionsSlot(header);
    if (slot === header) {
      header.appendChild(btn);
      header.appendChild(followupBtn);
      header.appendChild(notesBtn);
      header.appendChild(scheduleBtn);
      header.appendChild(profileBtn);
      header.appendChild(saveContactBtn);
      header.appendChild(boltBtn);
    } else {
      slot.insertAdjacentElement("beforebegin", btn);
      btn.insertAdjacentElement("afterend", followupBtn);
      followupBtn.insertAdjacentElement("afterend", notesBtn);
      notesBtn.insertAdjacentElement("afterend", scheduleBtn);
      scheduleBtn.insertAdjacentElement("afterend", profileBtn);
      profileBtn.insertAdjacentElement("afterend", saveContactBtn);
      saveContactBtn.insertAdjacentElement("afterend", boltBtn);
    }
    updateFunnelBadge();
    updateFollowupBadge();
    updateNotesBadge();
    updateScheduleBadge();
    // Dispara na hora, sem esperar o ciclo de 1.5s — é aqui que detecta
    // que a conversa mudou de verdade (cabeçalho recriado), então é o
    // ponto certo pra já checar se o novo contato está salvo.
    void updateSaveContactButton();
  }


  // ---------------------------------------------------------------------
  // Pop-up de Funis — lista os funis, entra nas etapas, adiciona o contato
  // da conversa, E mostra de cara se o lead já está em algum funil (com
  // botão de remover), pra nunca ficar em dúvida nem duplicado em duas
  // etapas ao mesmo tempo.
  // ---------------------------------------------------------------------

  /** Todos os cards (em qualquer funil) que já são esse contato. */
  function membershipsFor(chat) {
    const out = [];
    for (const f of funnels) {
      if (f.mode === "label") continue;
      for (const c of f.cards || []) {
        const matchId = chat.wa_id && c.wa_id === chat.wa_id;
        const matchPhone = !matchId && chat.phone && c.phone === chat.phone;
        if (matchId || matchPhone) {
          const stage = (f.stages || []).find((s) => s.id === c.stage_id);
          out.push({ funnel: f, stage, card: c });
        }
      }
    }
    return out;
  }

  /** true se a conversa aberta agora tem card em QUALQUER funil (não só
   * um "principal") — o popover do ícone já cobre todos, então o
   * indicador precisa bater com isso. */
  function activeChatInMainFunnel() {
    const dom = activeChatFromDom();
    const waId = dom?.wa_id || null;
    const phone = dom?.phone || null;
    if (!waId && !phone) return false;
    // Antes ignorava funis do tipo "label" (baseados em etiqueta do
    // WhatsApp) — só contava manual/aba. Agora conta qualquer tipo: se o
    // lead está em algum funil, mostra a bolinha, ponto.
    return funnels.some((f) => (f.cards || []).some((c) => (waId && c.wa_id === waId) || (phone && c.phone === phone)));
  }

  /** Bolinha no ícone do funil — indica de cara que o lead já está no
   * Funil principal, sem precisar abrir nada. */
  function updateFunnelBadge() {
    const btn = document.getElementById(CHAT_BTN_ID);
    if (!btn) return;
    btn.classList.toggle("crm-chat-btn-active", activeChatInMainFunnel());
  }

  /** Todos os cards (em qualquer funil) do contato aberto agora que têm
   * follow-up configurado na etapa em que estão — um contato pode
   * aparecer em mais de um funil ao mesmo tempo. */
  function activeChatFollowupEntries() {
    // wa_id é o mais confiável (contato sincronizado do WhatsApp), mas
    // cards criados/adicionados só com telefone (sem sincronizar ainda)
    // não têm wa_id — sem esse fallback por telefone, o reloginho nunca
    // aparecia pra esses leads, mesmo aparecendo certinho no kanban do
    // site (que não depende de wa_id pra montar o card).
    const dom = activeChatFromDom();
    const waId = dom?.wa_id || null;
    const phone = dom?.phone || null;
    if (!waId && !phone) return [];
    const out = [];
    for (const f of funnels) {
      if (f.mode === "label") continue;
      for (const c of f.cards || []) {
        const matches = (waId && c.wa_id === waId) || (phone && c.phone === phone);
        if (matches && c.followup) {
          const stage = (f.stages || []).find((s) => s.id === c.stage_id);
          out.push({ funnelName: f.name, stageName: stage?.name || "", followup: c.followup });
        }
      }
    }
    return out;
  }

  /** Reloginho de follow-up no cabeçalho da conversa — só aparece quando
   * esse contato está numa etapa com follow-up configurado. Pulsa
   * (destaque) quando a próxima mensagem já passou da hora prevista
   * (está sendo processada pelo avaliador automático agora). */
  function updateFollowupBadge() {
    const btn = document.getElementById(FOLLOWUP_BTN_ID);
    if (!btn) return;
    const entries = activeChatFollowupEntries();
    if (!entries.length) {
      btn.style.display = "none";
      return;
    }
    btn.style.display = "";
    const pending = entries.filter((e) => !e.followup.all_sent);
    const isOverdue = pending.some(
      (e) => e.followup.next_due_at && new Date(e.followup.next_due_at).getTime() <= Date.now(),
    );
    btn.classList.toggle("crm-chat-btn-active", pending.length > 0);
    btn.classList.toggle("crm-followup-btn-overdue", isOverdue);

    // Selinho numérico "enviados/total" — antes o ícone só trocava de
    // cor, sem dizer quantas mensagens já foram; agora mostra de cara,
    // igual o selo de não lidas do WhatsApp.
    const totalSent = entries.reduce((sum, e) => sum + e.followup.sent_count, 0);
    const totalSteps = entries.reduce((sum, e) => sum + e.followup.total_steps, 0);
    let countEl = btn.querySelector(".crm-followup-count");
    if (!countEl) {
      countEl = document.createElement("span");
      countEl.className = "crm-followup-count";
      btn.appendChild(countEl);
    }
    countEl.textContent = `${totalSent}/${totalSteps}`;
  }

  /** Selinho numérico genérico — reaproveitado pelos ícones de Notas e
   * Agendamento. Some sozinho quando a contagem é zero (o ícone continua
   * lá, só sem número — "ganha vida" só quando tem algo de verdade). */
  function setChatBtnCount(btn, count) {
    let el = btn.querySelector(".crm-chat-count-badge");
    if (!count || count <= 0) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement("span");
      el.className = "crm-chat-count-badge";
      btn.appendChild(el);
    }
    el.textContent = count > 9 ? "9+" : String(count);
  }

  /** Numerozinho de anotações no ícone — usa o mesmo cache de prefetch
   * que já existia (só pro hover antes); se ainda não tem cache pra essa
   * conversa, dispara a busca e atualiza sozinho na próxima rodada.
   * Usa activeChat() (a versão "de verdade", que pergunta pra ponte
   * quando precisa) em vez de activeChatFromDom() — a versão só-DOM
   * lê o telefone escaneando o TEXTO do cabeçalho, que só aparece pra
   * contatos ainda não salvos; pra maioria (contato salvo, aparece só o
   * nome) ela nunca achava o telefone, e o selinho ficava sempre em
   * zero. activeChat() é assíncrona, mas resolve na hora pra contato já
   * em cache — só busca de verdade (com um pequeno atraso) na primeira
   * vez que abre essa conversa. */
  async function updateNotesBadge() {
    const btn = document.getElementById(NOTES_BTN_ID);
    if (!btn) return;
    const chat = await activeChat();
    const contactDbId = chat?.contact_db_id || null;
    const phone = chat?.phone || null;
    if (!contactDbId && !phone) {
      setChatBtnCount(btn, 0);
      return;
    }
    const matches =
      notesPrefetch &&
      ((contactDbId && notesPrefetch.chat?.contact_db_id === contactDbId) || (phone && notesPrefetch.chat?.phone === phone));
    if (matches) {
      setChatBtnCount(btn, notesPrefetch.notes.length);
    } else {
      setChatBtnCount(btn, 0);
      await prefetchNotes();
      // A conversa pode ter mudado durante a busca — só aplica o
      // resultado se o botão ainda for da mesma conversa.
      const stillSame = document.getElementById(NOTES_BTN_ID) === btn;
      if (stillSame) updateNotesBadge();
    }
  }

  /** Numerozinho de mensagens agendadas de verdade (não conta follow-up
   * nem lembretes automáticos — já filtrados no backend). Só as
   * "pending" (ainda vão acontecer); enviadas/falhadas já são passado.
   * Mesma correção do updateNotesBadge: usa activeChat() em vez de
   * activeChatFromDom(), pelo mesmo motivo (telefone não aparece no
   * texto do cabeçalho pra contatos já salvos, que são a maioria). */
  async function updateScheduleBadge() {
    const btn = document.getElementById(SCHEDULE_BTN_ID);
    if (!btn) return;
    const chat = await activeChat();
    const contactDbId = chat?.contact_db_id || null;
    const phone = chat?.phone || null;
    if (!contactDbId && !phone) {
      setChatBtnCount(btn, 0);
      return;
    }
    const matches =
      schedulePrefetch &&
      ((contactDbId && schedulePrefetch.chat?.contact_db_id === contactDbId) || (phone && schedulePrefetch.chat?.phone === phone));
    if (matches) {
      const pending = schedulePrefetch.jobs.filter((j) => j.status === "pending").length;
      setChatBtnCount(btn, pending);
    } else {
      setChatBtnCount(btn, 0);
      await prefetchSchedule();
      const stillSame = document.getElementById(SCHEDULE_BTN_ID) === btn;
      if (stillSame) updateScheduleBadge();
    }
  }

  function humanizeFollowupDue(dueAtIso) {
    if (!dueAtIso) return "";
    const diffMs = new Date(dueAtIso).getTime() - Date.now();
    if (diffMs <= 0) return "processando agora";
    const min = Math.round(diffMs / 60000);
    if (min < 60) return `em ${min}min`;
    const hours = Math.round(min / 60);
    if (hours < 24) return `em ${hours}h`;
    return `em ${Math.round(hours / 24)}d`;
  }

  /** Popup leve com o relatório de follow-up do contato aberto — quantas
   * mensagens da sequência já foram enviadas, quando vem a próxima. */
  function openFollowupStatusPopover(anchor) {
    document.querySelectorAll(".crm-menu, .crm-lite-pop, .crm-fn-pop, .crm-followup-pop").forEach((el) => el.remove());
    const pop = document.createElement("div");
    pop.className = "crm-lite-pop crm-followup-pop";
    const rect = anchor.getBoundingClientRect();
    pop.style.top = `${rect.bottom + 8}px`;
    pop.style.left = `${Math.min(Math.max(8, rect.left), window.innerWidth - 280)}px`;

    const entries = activeChatFollowupEntries();
    pop.innerHTML = `
      <p class="crm-lite-pop-title">Follow-up</p>
      ${entries
        .map(
          (e) => `
        <div class="crm-followup-pop-entry">
          <p class="crm-followup-pop-funnel">${escapeHtml(e.funnelName)} · ${escapeHtml(e.stageName)}</p>
          <p class="crm-followup-pop-count">${e.followup.sent_count}/${e.followup.total_steps} enviada${e.followup.total_steps === 1 ? "" : "s"}</p>
          <p class="crm-followup-pop-next">${
            e.followup.all_sent ? "Sequência concluída." : `Próxima: ${humanizeFollowupDue(e.followup.next_due_at)}`
          }</p>
        </div>
      `,
        )
        .join('<div class="crm-followup-pop-divider"></div>')}
    `;
    document.body.appendChild(pop);
    animatePopIn(pop);
    const close = () => {
      pop.remove();
      document.removeEventListener("mousedown", onDoc, true);
    };
    function onDoc(ev) {
      if (!pop.contains(ev.target) && ev.target !== anchor) close();
    }
    setTimeout(() => document.addEventListener("mousedown", onDoc, true), 0);
  }

  /** Popup "Minha conta" — status da assinatura, e-mail e telefone de
   * contato (editável, pro dono corrigir se digitou errado no
   * cadastro). Sobre a conta de quem está usando o CRM, não sobre o
   * lead da conversa aberta — por isso fica sempre visível, sem
   * depender de qual conversa está aberta. */
  function openAccountPopover(anchor) {
    document.querySelectorAll(".crm-menu, .crm-lite-pop, .crm-fn-pop, .crm-account-pop").forEach((el) => el.remove());
    const pop = document.createElement("div");
    pop.className = "crm-lite-pop crm-account-pop";
    const rect = anchor.getBoundingClientRect();
    // Ancorado pela DIREITA (não pela esquerda com uma largura chutada)
    // — a largura real do popup não precisa ser adivinhada nem bater
    // com nenhum número mágico, então nunca sai cortado pra fora da
    // tela, não importa o tamanho da janela.
    pop.style.top = `${rect.bottom + 8}px`;
    pop.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    pop.innerHTML = `<p class="crm-lite-pop-title">Minha conta</p><p class="crm-qrp-empty" style="padding:6px 0">Carregando…</p>`;
    document.body.appendChild(pop);
    animatePopIn(pop);

    const close = () => {
      pop.remove();
      document.removeEventListener("mousedown", onDoc, true);
    };
    function onDoc(ev) {
      if (!pop.contains(ev.target) && ev.target !== anchor) close();
    }
    setTimeout(() => document.addEventListener("mousedown", onDoc, true), 0);

    function formatDueDate(iso) {
      if (!iso) return "";
      return new Date(iso).toLocaleDateString("pt-BR");
    }

    let editingPhone = false;

    function render(account, billing) {
      const statusLabel = billing.premium
        ? billing.status === "courtesy"
          ? "Cortesia (sem cobrança)"
          : "Ativa"
        : "Plano grátis";
      const statusClass = billing.premium ? "crm-account-status-ok" : "crm-account-status-free";
      const phoneRow = editingPhone
        ? `<div class="crm-account-row crm-account-row-editing">
            <span class="crm-account-label">Telefone</span>
            <div class="crm-account-edit-inline">
              <input type="text" class="crm-account-edit-input" data-account-phone value="${escapeHtml(account.owner_phone || "")}" placeholder="Ex: 61999998888" />
              <button type="button" class="crm-account-edit-save" data-account-save title="Salvar">✓</button>
              <button type="button" class="crm-account-edit-cancel" data-account-cancel title="Cancelar">✕</button>
            </div>
          </div>`
        : `<div class="crm-account-row crm-account-row-editable" data-account-edit-phone>
            <span class="crm-account-label">Telefone</span>
            <span class="crm-account-value-editable">
              ${escapeHtml(account.owner_phone || "—")}
              <svg class="crm-account-pencil" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </span>
          </div>`;
      pop.innerHTML = `
        <p class="crm-lite-pop-title">Minha conta</p>
        ${account.shop_name ? `<p class="crm-account-shop">${escapeHtml(account.shop_name)}</p>` : ""}
        <div class="crm-account-row">
          <span class="crm-account-label">Status</span>
          <span class="${statusClass}">${statusLabel}</span>
        </div>
        ${
          billing.premium && billing.current_period_end
            ? `<div class="crm-account-row"><span class="crm-account-label">Vencimento</span><span>${formatDueDate(billing.current_period_end)}</span></div>`
            : ""
        }
        ${
          billing.can_manage
            ? `<button type="button" class="crm-lite-pop-confirm crm-account-manage-btn" data-account-manage>Gerenciar assinatura</button>`
            : ""
        }
        <div class="crm-account-divider"></div>
        <div class="crm-account-row">
          <span class="crm-account-label">E-mail</span>
          <span class="crm-account-value-readonly">${escapeHtml(account.owner_email || "—")}</span>
        </div>
        ${phoneRow}
        <p class="crm-account-hint" data-account-msg></p>
      `;
      pop.querySelector("[data-account-edit-phone]")?.addEventListener("click", () => {
        editingPhone = true;
        render(account, billing);
        pop.querySelector("[data-account-phone]")?.focus();
      });
      pop.querySelector("[data-account-cancel]")?.addEventListener("click", () => {
        editingPhone = false;
        render(account, billing);
      });
      pop.querySelector("[data-account-manage]")?.addEventListener("click", async () => {
        const btn = pop.querySelector("[data-account-manage]");
        const msg = pop.querySelector("[data-account-msg]");
        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = "Abrindo…";
        const r = await chrome.runtime
          .sendMessage({ type: "api", path: "/api/public/extension/billing-portal", opts: { method: "POST" } })
          .catch(() => null);
        btn.disabled = false;
        btn.textContent = originalText;
        if (r?.ok && r.url) {
          window.open(r.url, "_blank", "noopener,noreferrer");
        } else if (msg) {
          msg.textContent = r?.error || "Não consegui abrir a gestão da assinatura.";
          msg.classList.add("crm-account-hint-error");
        }
      });
      pop.querySelector("[data-account-save]")?.addEventListener("click", async () => {
        const input = pop.querySelector("[data-account-phone]");
        const msg = pop.querySelector("[data-account-msg]");
        const value = (input?.value || "").trim();
        if (!value) return;
        const btn = pop.querySelector("[data-account-save]");
        btn.disabled = true;
        const r = await chrome.runtime
          .sendMessage({
            type: "api",
            path: "/api/public/extension/account-info",
            opts: { method: "PATCH", body: JSON.stringify({ owner_phone: value }) },
          })
          .catch(() => null);
        btn.disabled = false;
        if (r?.ok) {
          account.owner_phone = value;
          editingPhone = false;
          render(account, billing);
        }
        if (msg) {
          msg.textContent = r?.ok ? "Telefone atualizado." : r?.error || "Não consegui salvar.";
          msg.classList.toggle("crm-account-hint-error", !r?.ok);
        }
      });
    }

    chrome.runtime
      .sendMessage({ type: "api", path: "/api/public/extension/account-info" })
      .then((r) => {
        if (!r?.ok) {
          pop.innerHTML = `<p class="crm-lite-pop-title">Minha conta</p><p class="crm-qrp-empty" style="padding:6px 0">${escapeHtml(r?.error || "Não consegui carregar.")}</p>`;
          return;
        }
        render(r.account, r.billing);
        // O aviso "COMPRAR PREMIUM" da barra do topo usa uma cópia
        // separada do status da assinatura, carregada só uma vez no
        // início — abrir "Minha conta" (que sempre busca fresquinho) é
        // um bom momento pra também atualizar essa cópia, evitando o
        // aviso do topo ficar desatualizado depois de mudar de plano.
        void loadBilling();
      })
      .catch(() => {
        pop.innerHTML = `<p class="crm-lite-pop-title">Minha conta</p><p class="crm-qrp-empty" style="padding:6px 0">Não consegui carregar.</p>`;
      });
  }

  /** Mostra o ícone de "salvar contato" só quando a conversa aberta ainda
   * não está salva na agenda de quem está usando o WhatsApp — sem isso,
   * o ícone ficaria sempre visível, mesmo pra contatos já salvos. Fica
   * plantado do ladinho do nome/número, separado dos outros 5 ícones. */
  /** Checagem dedicada e leve de "está salvo ou não" — não reaproveita
   * activeChat() de propósito, porque ali o nome vem de um atalho de
   * cache (rápido, mas não carrega is_saved). Sempre passa pela ponte,
   * mas só pra esse status — não busca telefone/nome/foto junto, então
   * fica bem mais rápido que o fluxo completo do Perfil. */
  async function isContactSaved() {
    const dom = activeChatFromDom();
    const fromBridge = await askBridge("active_chat_v290", "active_chat_done_v290", { domWaId: dom?.wa_id || null }, 8000);
    if (!fromBridge) return null;
    return {
      is_saved: !!fromBridge.is_saved,
      is_group: !!fromBridge.is_group,
      phone: fromBridge.phone || dom?.phone || null,
    };
  }

  async function updateSaveContactButton() {
    const btn = document.getElementById(SAVE_CONTACT_BTN_ID);
    if (!btn) return;
    try {
      const chat = await isContactSaved();
      const show = !!(chat && !chat.is_group && chat.is_saved === false && chat.phone);
      if (!show) {
        btn.style.display = "none";
        return;
      }
      const nameNode = headerNameNode();
      if (nameNode?.parentElement) {
        // Anexa no FIM do mesmo grupo do nome — não logo depois do nome
        // em si, porque contas verificadas têm um selinho ali do lado, e
        // entrar bem entre nome e selo ficava esquisito.
        nameNode.parentElement.appendChild(btn);
      }
      btn.style.display = "";
    } catch {
      btn.style.display = "none";
    }
  }

  /** Se o painel de Perfil estiver aberto e a pessoa trocar de conversa,
   * atualiza sozinho pro novo lead — sem isso, ficava mostrando os dados
   * do contato anterior até fechar e abrir de novo. */
  async function refreshProfilePanelIfStale() {
    if (activePanelKind !== "profile") return;
    const panel = document.querySelector(".crm-qrp");
    if (!panel) return;
    try {
      const chat = await activeChat();
      if (chat?.wa_id && chat.wa_id !== profilePanelWaId) {
        await renderProfilePanel(panel);
      }
    } catch {
      /* silencioso — só é uma atualização automática, não uma ação do usuário */
    }
  }

  /** Salva o contato da conversa aberta na agenda — só funciona no modo
   * não oficial (uazapi); o endpoint já barra e explica se for API
   * oficial (ela não tem esse conceito de agenda pra escrever). */
  async function saveActiveContact(anchor) {
    const chat = await activeChat();
    if (!chat?.wa_id) {
      crmToast("Não consegui identificar o contato dessa conversa.", "err", anchor);
      return false;
    }
    const name = await openInlinePrompt(anchor, {
      title: "Salvar contato",
      value: chat.push_name || "",
      confirmLabel: "Salvar",
    });
    if (!name || !name.trim()) return false; // cancelou (Esc, clicou fora, ou deixou vazio)
    // Chama a função nativa do próprio WhatsApp (mesma coisa que o botão
    // "Adicionar" na tela de dados do contato) — não depende de nenhuma
    // API externa nem de qual conexão a barbearia está usando.
    const r = await askBridge("save_contact_v1", "save_contact_done_v1", { waId: chat.wa_id, name: name.trim() }, 10000);
    if (r) {
      crmToast("Contato salvo!", "ok", anchor);
      void updateSaveContactButton();
      return true;
    } else {
      crmToast("Falha ao salvar contato.", "err", anchor);
      return false;
    }
  }

  // ---------------------------------------------------------------------
  // Popover leve do funil — ancorado no ícone, sem escurecer/desfocar o
  // fundo (não é mais um modal de tela cheia). Lista TODOS os funis (não
  // só um "principal"), um bloco por funil com divisória clara entre eles
  // — um lead pode estar em vários ao mesmo tempo. Clicar na bolinha
  // adiciona (se vazia) ou remove (se cheia) naquele funil específico.
  // ---------------------------------------------------------------------
  function openFunnelPopover(anchor) {
    document.querySelector(".crm-fn-pop")?.remove();
    const pop = document.createElement("div");
    pop.className = "crm-fn-pop";
    const rect = anchor.getBoundingClientRect();
    const popWidth = 240; // precisa bater com o width de .crm-fn-pop no CSS
    const centered = rect.left + rect.width / 2 - popWidth / 2;
    pop.style.top = `${rect.bottom + 8}px`;
    pop.style.left = `${Math.min(Math.max(8, centered), window.innerWidth - popWidth - 8)}px`;

    let chat = null;
    // Estado conhecido de em quais funis/etapas o lead está, guardado
    // localmente. NÃO comparamos mais contra o array global `funnels` a
    // cada render: ele é trocado por inteiro a cada loadFunnels() (rodando
    // em segundo plano o tempo todo), e comparar contra um snapshot antigo
    // é a causa exata do bug "preciso clicar duas vezes" — o clique fazia
    // efeito no servidor, mas a tela só reconhecia isso na consulta
    // seguinte.
    let membership = {}; // funnelId -> { cardId, stageId } | null

    function targetFunnels() {
      return funnels.filter((f) => f.mode !== "label");
    }

    function syncFromFunnels() {
      membership = {};
      if (!chat) return;
      for (const f of targetFunnels()) {
        const card = (f.cards || []).find(
          (c) => (chat.wa_id && c.wa_id === chat.wa_id) || (chat.phone && c.phone === chat.phone),
        );
        membership[f.id] = card ? { cardId: card.id, stageId: card.stage_id } : null;
      }
    }

    const renderRows = () => {
      const list = targetFunnels();
      if (!list.length) {
        pop.innerHTML = `<p class="crm-fn-pop-title">Funis</p><p class="crm-fn-pop-empty">Nenhum funil criado ainda.</p>`;
        return;
      }
      pop.innerHTML = list
        .map((f, i) => {
          const stages = f.stages || [];
          const currentStageId = membership[f.id]?.stageId || null;
          const divider = i > 0 ? `<div class="crm-fn-pop-divider"></div>` : "";
          if (!stages.length) {
            return `${divider}<p class="crm-fn-pop-title">${escapeHtml(f.name)}</p><p class="crm-fn-pop-empty">Ainda não tem etapas.</p>`;
          }
          return `${divider}<p class="crm-fn-pop-title">${escapeHtml(f.name)}</p>${stages
            .map((st) => {
              const isOn = st.id === currentStageId;
              return `<button class="crm-fn-pop-row" data-funnel="${escapeHtml(f.id)}" data-stage="${escapeHtml(st.id)}">
                <span class="crm-fn-pop-dot${isOn ? " is-on" : ""}"></span>
                <span class="crm-fn-pop-name">${escapeHtml(st.name)}</span>
              </button>`;
            })
            .join("")}`;
        })
        .join("");
    };

    document.body.appendChild(pop);
    animatePopIn(pop);
    renderRows();
    activeChat().then((c) => {
      chat = c;
      syncFromFunnels();
      renderRows();
    });
    void loadFunnels().then(() => {
      syncFromFunnels();
      renderRows();
    });

    const close = () => {
      pop.remove();
      document.removeEventListener("mousedown", onDoc, true);
    };
    function onDoc(ev) {
      if (!pop.contains(ev.target) && ev.target !== anchor) close();
    }
    setTimeout(() => document.addEventListener("mousedown", onDoc, true), 0);

    pop.addEventListener("click", async (e) => {
      const row = e.target.closest("[data-stage]");
      if (!row || row.disabled) return;
      const funnelId = row.getAttribute("data-funnel");
      const stageId = row.getAttribute("data-stage");
      const funnel = funnels.find((f) => f.id === funnelId);
      const stage = funnel && (funnel.stages || []).find((s) => s.id === stageId);
      if (!funnel || !stage) return;
      row.disabled = true;
      if (!chat) chat = await activeChat();
      if (!chat) {
        crmToast("Não consegui ler a conversa aberta.", "err", anchor);
        row.disabled = false;
        return;
      }
      const current = membership[funnelId];
      const wasOn = current?.stageId === stageId;

      if (wasOn) {
        if (!current?.cardId) { row.disabled = false; return; }
        const r = await chrome.runtime
          .sendMessage({ type: "api", path: "/api/public/extension/funnel-cards", opts: { method: "DELETE", body: JSON.stringify({ id: current.cardId } ) } })
          .catch(() => null);
        if (r?.ok) {
          crmToast(`Removido de ${funnel.name}`, "ok", anchor);
          membership[funnelId] = null;
          updateFunnelBadge();
          updateFollowupBadge();
          updateNotesBadge();
          updateScheduleBadge();
          renderRows();
          void loadFunnels();
        } else {
          crmToast(r?.error || "Não consegui remover.", "err", anchor);
          row.disabled = false;
        }
        return;
      }

      const r = await chrome.runtime
        .sendMessage({
          type: "api",
          path: "/api/public/extension/funnel-cards",
          opts: {
            method: "POST",
            body: JSON.stringify({
              funnel_id: funnel.id,
              stage_id: stage.id,
              title: chat.name || chat.phone || "Contato",
              phone: chat.phone || null,
              wa_contact_id: chat.contact_db_id || null,
            }),
          },
        })
        .catch(() => null);
      if (r?.ok) {
        crmToast(`Adicionado em ${funnel.name} · ${stage.name}`, "ok", anchor);
        membership[funnelId] = { cardId: r.card?.id || current?.cardId, stageId: stage.id };
        updateFunnelBadge();
        updateFollowupBadge();
        updateNotesBadge();
        updateScheduleBadge();
        renderRows();
        void loadFunnels();
      } else {
        crmToast(r?.error || "Não consegui adicionar ao funil.", "err", anchor);
        row.disabled = false;
      }
    });
  }

  // ---------------------------------------------------------------------
  // Pop-up de Respostas Rápidas — só selecionar e disparar.
  // A criação/edição continua no painel do CRM.
  // ---------------------------------------------------------------------
  const PENCIL_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
  const TRASH_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`;
  const UP_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>`;
  const DOWN_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M18 13l-6 6-6-6"/></svg>`;
  // Estrela vazada (não favoritada) e preenchida (favoritada) — mesma
  // silhueta, só muda fill/stroke, pra não trocar o ícone inteiro no toggle.
  const STAR_OUTLINE_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5l2.9 6.3 6.9.7-5.2 4.7 1.5 6.8L12 17.7l-6.1 3.3 1.5-6.8-5.2-4.7 6.9-.7Z"/></svg>`;
  const STAR_FILLED_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5l2.9 6.3 6.9.7-5.2 4.7 1.5 6.8L12 17.7l-6.1 3.3 1.5-6.8-5.2-4.7 6.9-.7Z"/></svg>`;
  const TAG_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 12.6 12 21.2 2.8 12 2.8 3.2 11.6 3.2Z"/><circle cx="7.2" cy="7.2" r="1.3" fill="currentColor" stroke="none"/></svg>`;
  const CHECK_SVG = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

  // Paleta de cores sugerida ao criar uma categoria (o usuário não é
  // obrigado a usar só essas — só ajuda a bater logo de cara com o
  // restante da interface). Mesma lista de src/lib/quick-replies.ts.
  const QUICK_REPLY_CATEGORY_COLORS = ["#3d5fa8", "#2e9e6b", "#c9822a", "#a34747", "#7b5ec7", "#3a9fb5"];

  const QR_STEP_TYPES = [
    { type: "text", label: "Texto" },
    { type: "image", label: "Imagem" },
    { type: "video", label: "Vídeo" },
    { type: "audio", label: "Áudio" },
    { type: "funnel_add", label: "Mover no funil" },
    { type: "funnel_remove", label: "Remover do funil" },
  ];

  // Mesma lista de src/lib/quick-replies.ts (QUICK_REPLY_VARIABLES) — só
  // pra montar os "chips" clicáveis no formulário. A substituição de
  // verdade acontece em handleWaAction() (fill()), que fica mais abaixo
  // neste mesmo arquivo.
  const QUICK_REPLY_VARIABLES = [
    { key: "nome", label: "Nome do contato" },
    { key: "primeiro_nome", label: "Só o primeiro nome" },
    { key: "telefone", label: "Telefone" },
  ];

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Não consegui ler o arquivo"));
      reader.readAsDataURL(file);
    });
  }

  // ---------------------------------------------------------------------
  // Painel de Respostas rápidas — ancorado no canto da tela (não fecha
  // sozinho, fica aberto pra disparar várias respostas durante o
  // atendimento). Dois níveis: lista de respostas, e o editor de passos
  // (texto/imagem/vídeo/áudio/funil) de uma resposta específica.
  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------
  // Painel de Perfil do cliente / Valor do cliente — mesmo container
  // docado do painel de respostas rápidas (não sobrepõe a conversa),
  // buscando e salvando pelos dois endpoints novos.
  // ---------------------------------------------------------------------
  // Contador de "qual foi a chamada mais recente" — troca de lead rápida
  // dispara renderProfilePanel várias vezes antes da anterior terminar de
  // carregar (ela tem dois "await" no meio); sem isso, uma chamada velha
  // podia escrever por cima depois da mais nova já ter desenhado a tela
  // certa, dando a impressão de botão duplicado.
  let profileRenderSeq = 0;

  async function renderProfilePanel(panel) {
    const kind = "profile";
    const mySeq = ++profileRenderSeq;
    panel.innerHTML = `<div class="crm-qrp-head"><div class="crm-qr-mark">${PROFILE_SVG}</div><p class="crm-qrp-title">Perfil do cliente</p><button class="crm-qrp-close" data-close title="Fechar">&times;</button></div>${panelSwitcherHtml(kind)}<div class="crm-qrp-body"><p class="crm-fn-pop-empty">Carregando...</p></div>`;
    // Handler temporário, só pra enquanto os dados carregam (fechar/trocar
    // de aba). O de verdade — que também cobre o botão "Salvar na agenda" —
    // é montado mais abaixo, depois que o conteúdo real existe; ACHADO DO
    // BUG: aquele de baixo pisava em cima deste sem saber lidar com
    // [data-save-contact], fazendo o clique nesse botão não fazer nada.
    panelClickHandler = (e) => {
      if (e.target.closest("[data-close]")) return closeSharedPanel();
      const sw = e.target.closest("[data-switch]");
      if (sw) return void openSharedPanel(sw.getAttribute("data-switch"));
    };

    const chat = await activeChat();
    const contactQuery = contactIdentityQuery(chat?.contact_db_id, chat?.phone);

    if (mySeq !== profileRenderSeq || activePanelKind !== kind || !panel.isConnected) return; // uma chamada mais nova já assumiu, ou usuário trocou/fechou
    if (!chat || !contactQuery) {
      panel.querySelector(".crm-qrp-body").innerHTML = `<p class="crm-fn-pop-empty">Não consegui identificar o contato dessa conversa.</p>`;
      return;
    }

    const cached = (waData.contacts || []).find((c) => chat.wa_id && c.wa_id === chat.wa_id);
    const [profileRes, dealRes, photo, savedInfo] = await Promise.all([
      chrome.runtime.sendMessage({ type: "api", path: `/api/public/extension/customer-profile?${contactQuery}` }).catch(() => null),
      chrome.runtime.sendMessage({ type: "api", path: `/api/public/extension/customer-deal?${contactQuery}` }).catch(() => null),
      cached?.profile_picture_url
        ? Promise.resolve(cached.profile_picture_url)
        : chat.wa_id
          ? askBridge("profile_picture_v1", "profile_picture_done_v1", { waId: chat.wa_id }, 8000).then((r) => r?.url || null)
          : Promise.resolve(null),
      // activeChat() não carrega is_saved (é um atalho de cache, ver
      // comentário lá) — busca isso separado, em paralelo, pra não
      // atrasar o resto do Perfil.
      isContactSaved().catch(() => null),
    ]);
    if (mySeq !== profileRenderSeq || activePanelKind !== kind || !panel.isConnected) return;
    profilePanelWaId = chat.wa_id || null;
    const profile = (profileRes?.ok ? profileRes.profile : null) || {};
    const deal = (dealRes?.ok ? dealRes.deal : null) || {};

    // "Observações" é a MESMA anotação já usada no card do funil (aba
    // Anotações do CRM) — sincroniza os dois lados.
    const funnel = tabFunnel();
    const matchedCard =
      (funnel?.cards || []).find(
        (c) => (chat.wa_id && c.wa_id === chat.wa_id) || (chat.phone && c.phone === chat.phone),
      ) || null;
    if (!deal.notes && matchedCard?.notes) deal.notes = matchedCard.notes;

    const body = panel.querySelector(".crm-qrp-body");
    const initial = (profile.name || chat.name || chat.phone || "?").trim().charAt(0).toUpperCase();
    body.innerHTML = `
      <div class="crm-cp-avatar-row">
        ${photo ? `<img src="${escapeHtml(photo)}" class="crm-cp-avatar-photo" alt="" />` : `<div class="crm-cp-avatar">${escapeHtml(initial)}</div>`}
        <div class="crm-cp-name-row">
          <input class="crm-cp-name-input" data-f="name" value="${escapeHtml(profile.name || chat.name || "")}" placeholder="Nome do contato" />
          <span class="crm-cp-name-pencil">${PENCIL_SVG}</span>
        </div>
        <p class="crm-cp-phone">${escapeHtml(chat.phone || "")}</p>
        ${
          savedInfo?.is_saved === false
            ? `<button type="button" class="crm-cp-save-contact" data-save-contact>${SAVE_CONTACT_SVG} Salvar na agenda</button>`
            : ""
        }
      </div>

      <p class="crm-cp-section-title">Dados pessoais</p>
      <div class="crm-cp-row2">
        <label class="crm-cp-field"><span>Email</span><input class="crm-qrp-input" data-f="email" value="${escapeHtml(profile.email || "")}" placeholder="email@exemplo.com" /></label>
        <label class="crm-cp-field"><span>Sexo</span>
          <select class="crm-qrp-select" data-f="gender">
            <option value="">Selecione</option>
            <option value="feminino" ${profile.gender === "feminino" ? "selected" : ""}>Feminino</option>
            <option value="masculino" ${profile.gender === "masculino" ? "selected" : ""}>Masculino</option>
            <option value="outro" ${profile.gender === "outro" ? "selected" : ""}>Outro</option>
            <option value="prefiro_nao_dizer" ${profile.gender === "prefiro_nao_dizer" ? "selected" : ""}>Prefiro não dizer</option>
          </select>
        </label>
      </div>
      <div class="crm-cp-row2">
        <label class="crm-cp-field"><span>Data de nascimento</span><input class="crm-qrp-input" type="date" data-f="birth_date" value="${escapeHtml(profile.birth_date || "")}" /></label>
        <label class="crm-cp-field"><span>Cidade</span><input class="crm-qrp-input" data-f="city" value="${escapeHtml(profile.city || "")}" /></label>
      </div>

      <p class="crm-cp-section-title">Negociação</p>
      <div class="crm-cp-row2">
        <label class="crm-cp-field"><span>Origem do lead</span><input class="crm-qrp-input" data-f="lead_source" value="${escapeHtml(deal.lead_source || "")}" placeholder="Ex: Instagram, indicação..." /></label>
        <label class="crm-cp-field"><span>Estágio do contato</span><input class="crm-qrp-input" data-f="stage_label" value="${escapeHtml(deal.stage_label || "")}" placeholder="Ex: Qualificando" /></label>
      </div>
      <div class="crm-cp-row2">
        <label class="crm-cp-field"><span>Data de entrada</span><input class="crm-qrp-input" type="date" data-f="entry_date" value="${escapeHtml(deal.entry_date || "")}" /></label>
        <label class="crm-cp-field"><span>Data de saída</span><input class="crm-qrp-input" type="date" data-f="exit_date" value="${escapeHtml(deal.exit_date || "")}" /></label>
      </div>
      <label class="crm-cp-field"><span>${DEAL_SVG} Valor do negócio (R$)</span><input class="crm-qrp-input" data-f="value_reais" value="${deal.value_cents != null ? (deal.value_cents / 100).toFixed(2) : ""}" placeholder="0,00" /></label>
      <label class="crm-cp-field"><span>Produto de interesse</span><input class="crm-qrp-input" data-f="products_of_interest" value="${escapeHtml(deal.products_of_interest || "")}" /></label>

      <p class="crm-cp-section-title">Observações</p>
      <label class="crm-cp-field"><textarea class="crm-qrp-textarea" data-f="notes" placeholder="Adicione uma observação">${escapeHtml(deal.notes || "")}</textarea></label>
    `;

    const foot = document.createElement("div");
    foot.className = "crm-qrp-foot";
    foot.innerHTML = `<button class="crm-qrp-save" data-save disabled>Salvar</button>`;
    panel.appendChild(foot);
    const saveBtn = foot.querySelector("[data-save]");

    const markDirty = () => { saveBtn.disabled = false; };
    panelInputHandler = markDirty;
    panelChangeHandler = markDirty;

    panelClickHandler = async (e) => {
      if (e.target.closest("[data-close]")) return closeSharedPanel();
      const sw = e.target.closest("[data-switch]");
      if (sw) return void openSharedPanel(sw.getAttribute("data-switch"));
      // ESTE handler substitui por completo o de cima (mesma variável
      // panelClickHandler) — era aqui que o clique em "Salvar na agenda"
      // se perdia silenciosamente, porque esse bloco só sabia lidar com
      // [data-save] (o botão geral do rodapé) e ignorava [data-save-contact]
      // (o botão de dentro do card de avatar/nome/telefone).
      const saveContactBtn = e.target.closest("[data-save-contact]");
      if (saveContactBtn) {
        e.preventDefault();
        e.stopPropagation();
        void saveActiveContact(saveContactBtn).then((saved) => {
          // Só some o botão se salvou de verdade — cancelar (clicar fora,
          // Esc, ou deixar o nome vazio) devolve false, e o botão continua
          // ali pra tentar de novo.
          if (saved && activePanelKind === "profile") saveContactBtn.remove();
        });
        return;
      }
      if (!e.target.closest("[data-save]") || saveBtn.disabled) return;

      const profileFields = {};
      const dealFields = {};
      const dealKeys = ["lead_source", "stage_label", "entry_date", "exit_date", "products_of_interest", "notes"];
      panel.querySelectorAll("[data-f]").forEach((el) => {
        const key = el.getAttribute("data-f");
        if (key === "value_reais") {
          const num = parseFloat(String(el.value).replace(",", "."));
          dealFields.value_cents = Number.isFinite(num) ? Math.round(num * 100) : null;
        } else if (dealKeys.includes(key)) {
          dealFields[key] = el.value.trim() || null;
        } else {
          profileFields[key] = el.value.trim() || null;
        }
      });

      saveBtn.disabled = true;
      saveBtn.textContent = "Salvando...";

      if (matchedCard && dealFields.notes !== (matchedCard.notes || null)) {
        await chrome.runtime
          .sendMessage({
            type: "api",
            path: "/api/public/extension/funnel-cards",
            opts: { method: "PATCH", body: JSON.stringify({ id: matchedCard.id, notes: dealFields.notes }) },
          })
          .catch(() => null);
        matchedCard.notes = dealFields.notes;
      }

      const [r1, r2] = await Promise.all([
        chrome.runtime.sendMessage({
          type: "api",
          path: "/api/public/extension/customer-profile",
          opts: { method: "PATCH", body: JSON.stringify({ wa_contact_id: chat.contact_db_id || null, phone: chat.phone || null, ...profileFields }) },
        }).catch(() => null),
        chrome.runtime.sendMessage({
          type: "api",
          path: "/api/public/extension/customer-deal",
          opts: { method: "PATCH", body: JSON.stringify({ wa_contact_id: chat.contact_db_id || null, phone: chat.phone || null, ...dealFields }) },
        }).catch(() => null),
      ]);

      saveBtn.textContent = "Salvar";
      if (r1?.ok && r2?.ok) {
        saveBtn.disabled = true;
      } else {
        saveBtn.disabled = false;
        crmToast((r1 && !r1.ok && r1.error) || (r2 && !r2.ok && r2.error) || "Não consegui salvar.", "err");
      }
    };
  }

  /** Cor de texto (preto ou branco) com bom contraste em cima da cor de
   * fundo dada — pra blocos sólidos de categoria ficarem sempre legíveis,
   * seja a cor escolhida clara ou escura. */
  function contrastTextColor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return "#fff";
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.62 ? "#1a1a1a" : "#ffffff";
  }

  /** Mistura a cor com branco (0 = cor original, 1 = branco puro) — usada
   * pra pintar o fundo de cada resposta dentro do bloco da categoria com
   * uma versão bem clara da cor, só pra dar identidade visual sem
   * atrapalhar a leitura do texto por cima. */
  function lightenColor(hex, amount) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const mix = (c) => Math.round(c + (255 - c) * amount);
    const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
    return `rgb(${r}, ${g}, ${b})`;
  }

  async function renderQuickReplyPanel(panel) {
    prewarmEngine();

    let mode = "list";
    let editingId = null;
    let steps = [];
    let savingFile = false;
    let favoriteValue = false;
    // Filtros da lista — resetam toda vez que o painel é reaberto.
    // "all" | "fav" | "none" (sem categoria) | "cat" (usa filterCategoryIds)
    let filterMode = "all";
    let filterCategoryIds = []; // pode selecionar mais de uma categoria ao mesmo tempo

    function firstTextOf(reply) {
      return (reply?.actions || []).find((a) => a.type === "text")?.text || "";
    }
    function stepSummary(reply) {
      const n = (reply?.actions || []).length;
      return `${n} passo${n === 1 ? "" : "s"}`;
    }
    function categoryById(id) {
      return id ? quickReplyCategories.find((c) => c.id === id) || null : null;
    }
    // Bloco cheio da cor da categoria (não só uma bolinha) — dá pra
    // reconhecer a categoria de longe, só pela cor.
    function categoryChipHtml(cat) {
      if (!cat) return "";
      return `<span class="crm-qrp-row-cat" style="background:${escapeHtml(cat.color)};color:${contrastTextColor(cat.color)}">${escapeHtml(cat.name)}</span>`;
    }

    /** Popup de escolher categoria(s) pra filtrar — seleção múltipla, fica
     * aberto até clicar fora, atualizando a lista embaixo em tempo real a
     * cada categoria marcada/desmarcada. Separado num popup em vez de
     * mostrar todas as categorias lado a lado nos filtros, porque com
     * várias categoriais isso poluía a tela inteira. */
    function openCategoryFilterPopup(anchor) {
      document.querySelectorAll(".crm-menu, .crm-lite-pop, .crm-confirm-pop, .crm-cat-filter-pop").forEach((el) => el.remove());
      const pop = document.createElement("div");
      pop.className = "crm-cat-filter-pop";
      const rect = anchor.getBoundingClientRect();
      pop.style.top = `${rect.bottom + 8}px`;
      pop.style.left = `${Math.min(Math.max(8, rect.left), window.innerWidth - 260)}px`;
      document.body.appendChild(pop);
      animatePopIn(pop);

      // Só seleção aqui — editar/excluir categoria ficam no próprio bloco
      // colorido dela na lista (mais intuitivo que escondido num popup
      // de filtro à parte).
      function paint() {
        pop.innerHTML = quickReplyCategories.length
          ? `<p class="crm-cat-filter-pop-hint">Escolha uma ou mais categorias</p>${quickReplyCategories
              .map((c) => {
                const checked = filterCategoryIds.includes(c.id);
                return `<div class="crm-cat-filter-pop-item ${checked ? "is-checked" : ""}" data-toggle-cat="${c.id}">
                  <span class="crm-cat-filter-pop-check" style="${checked ? `background:${escapeHtml(c.color)};border-color:${escapeHtml(c.color)}` : ""}">${checked ? CHECK_SVG : ""}</span>
                  <span class="crm-qrp-cat-dot" style="background:${escapeHtml(c.color)}"></span>
                  <span class="crm-cat-filter-pop-name">${escapeHtml(c.name)}</span>
                </div>`;
              })
              .join("")}`
          : `<p class="crm-qrp-empty" style="padding:14px">Nenhuma categoria criada ainda.</p>`;
      }
      paint();

      pop.addEventListener("click", async (e) => {
        const item = e.target.closest("[data-toggle-cat]");
        if (!item) return;
        const id = item.getAttribute("data-toggle-cat");
        filterCategoryIds = filterCategoryIds.includes(id)
          ? filterCategoryIds.filter((x) => x !== id)
          : [...filterCategoryIds, id];
        filterMode = filterCategoryIds.length ? "cat" : "all";
        paint();
        renderList();
      });

      const close = () => {
        pop.remove();
        document.removeEventListener("mousedown", onDoc, true);
      };
      function onDoc(ev) {
        if (!pop.contains(ev.target)) close();
      }
      setTimeout(() => document.addEventListener("mousedown", onDoc, true), 0);
    }

    /** Popup de criar OU editar categoria (nome + cor) — se "existing" for
     * passado, vira edição (título/botão mudam, e salva com PATCH em vez
     * de POST). Usado tanto pelo menu do botão único "+ Nova" (criar)
     * quanto pelo lápis dentro do popup de filtro por categoria (editar). */
    function openCategoryEditPopup(anchor, existing) {
      return new Promise((resolve) => {
        document.querySelectorAll(".crm-menu, .crm-lite-pop, .crm-cat-filter-pop").forEach((el) => el.remove());
        const pop = document.createElement("div");
        pop.className = "crm-lite-pop crm-cat-create-pop";
        const rect = anchor.getBoundingClientRect();
        pop.style.top = `${rect.bottom + 8}px`;
        pop.style.left = `${Math.min(Math.max(8, rect.left), window.innerWidth - 260)}px`;
        const initialColor = (existing?.color || QUICK_REPLY_CATEGORY_COLORS[0]).toLowerCase();
        pop.innerHTML = `
          <p class="crm-lite-pop-title">${existing ? "Editar categoria" : "Nova categoria"}</p>
          <input class="crm-lite-pop-input" placeholder="Nome da categoria" maxlength="60" value="${escapeHtml(existing?.name || "")}" />
          <div class="crm-qrp-color-row">
            ${QUICK_REPLY_CATEGORY_COLORS.map((hex) => `<button type="button" class="crm-qrp-color-swatch ${hex.toLowerCase() === initialColor ? "is-selected" : ""}" data-color-swatch="${hex}" style="background:${hex}"></button>`).join("")}
          </div>
          <button class="crm-lite-pop-confirm">${existing ? "Salvar" : "Criar categoria"}</button>
        `;
        document.body.appendChild(pop);
        animatePopIn(pop);
        const input = pop.querySelector(".crm-lite-pop-input");
        pop.querySelectorAll("[data-color-swatch]").forEach((sw) => {
          sw.addEventListener("click", () => {
            pop.querySelectorAll("[data-color-swatch]").forEach((el) => el.classList.remove("is-selected"));
            sw.classList.add("is-selected");
          });
        });
        const cleanup = () => {
          pop.remove();
          document.removeEventListener("mousedown", onDoc, true);
        };
        const submit = async () => {
          const name = input.value.trim();
          if (!name) { crmToast("Dá um nome pra categoria.", "err"); return; }
          const color = pop.querySelector(".crm-qrp-color-swatch.is-selected")?.getAttribute("data-color-swatch") || QUICK_REPLY_CATEGORY_COLORS[0];
          const path = existing
            ? `/api/public/extension/quick-reply-categories/${existing.id}`
            : "/api/public/extension/quick-reply-categories";
          const r = await chrome.runtime
            .sendMessage({
              type: "api",
              path,
              opts: { method: existing ? "PATCH" : "POST", body: JSON.stringify({ name, color }) },
            })
            .catch(() => null);
          if (r?.ok) {
            crmToast(existing ? "Categoria atualizada" : "Categoria criada");
            await loadQuickReplyCategories();
            // A cor pode ter mudado — os blocos/badges das respostas dessa
            // categoria precisam recalcular com a cor nova.
            if (existing) await loadQuickReplies();
            cleanup();
            resolve(r.category);
          } else {
            crmToast(r?.error || "Não consegui salvar a categoria.", "err");
          }
        };
        function onDoc(ev) {
          if (!pop.contains(ev.target) && ev.target !== anchor) { cleanup(); resolve(null); }
        }
        setTimeout(() => document.addEventListener("mousedown", onDoc, true), 150);
        pop.querySelector(".crm-lite-pop-confirm").addEventListener("click", submit);
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") { cleanup(); resolve(null); }
        });
        setTimeout(() => input.focus(), 30);
      });
    }

    let collapsedCategoryIds = new Set(); // categorias recolhidas (clicou pra fechar o bloco)

    function rowHtml(q, { showCategoryBadge = false, bgColor = null } = {}) {
      return `<div class="crm-qrp-row"${bgColor ? ` style="background:${bgColor}"` : ""}>
        <button class="crm-qrp-icon crm-qrp-star ${q.is_favorite ? "is-fav" : ""}" data-fav="${q.id}" title="${q.is_favorite ? "Remover dos favoritos" : "Favoritar"}">${q.is_favorite ? STAR_FILLED_SVG : STAR_OUTLINE_SVG}</button>
        <div class="crm-qrp-row-info" data-edit="${q.id}">
          <p class="crm-qrp-row-name">${escapeHtml(q.title)}${showCategoryBadge ? categoryChipHtml(categoryById(q.category_id)) : ""}</p>
          <p class="crm-qrp-row-sub">${q.shortcut ? `/${escapeHtml(q.shortcut)} · ` : ""}${escapeHtml(stepSummary(q))}${firstTextOf(q) ? " · " + escapeHtml(firstTextOf(q)).slice(0, 40) : ""}</p>
        </div>
        <button class="crm-qrp-icon" data-edit="${q.id}" title="Editar">${PENCIL_SVG}</button>
        <button class="crm-qrp-icon crm-qrp-icon-danger" data-del="${q.id}" title="Excluir">${TRASH_SVG}</button>
        <button class="crm-qrp-send" data-send="${q.id}" title="Enviar">${ICONS.send}</button>
      </div>`;
    }

    // Bloco de categoria — cabeçalho cheio da cor, com as respostas dela
    // agrupadas dentro (dobrável). Cada resposta do bloco também recebe um
    // fundo bem clareado da MESMA cor (não branco) — dá identidade visual
    // ao bloco inteiro sem atrapalhar a leitura do texto por cima.
    //
    // Lápis e lixeira ficam bem aqui, no próprio bloco — pequenos e
    // discretos, mas sempre visíveis (não escondidos atrás de hover, e
    // não escondidos dentro de outro popup). Botões SEPARADOS do toggle
    // de dobrar/desdobrar (que é só a área do nome/contador + a seta), pra
    // clicar neles não abrir/fechar o bloco sem querer.
    function categorySectionHtml(cat, items) {
      if (!items.length) return "";
      const collapsed = collapsedCategoryIds.has(cat.id);
      const textColor = contrastTextColor(cat.color);
      const rowBg = lightenColor(cat.color, 0.86);
      return `<div class="crm-qrp-cat-section">
        <div class="crm-qrp-cat-section-head" style="background:${escapeHtml(cat.color)};color:${textColor}">
          <button type="button" class="crm-qrp-cat-section-toggle" data-toggle-collapse="${cat.id}">
            <span class="crm-qrp-cat-section-name">${escapeHtml(cat.name)}</span>
            <span class="crm-qrp-cat-section-count">${items.length}</span>
          </button>
          <button type="button" class="crm-qrp-cat-section-icon" data-edit-cat-section="${cat.id}" title="Editar categoria">${PENCIL_SVG}</button>
          <button type="button" class="crm-qrp-cat-section-icon" data-del-cat-section="${cat.id}" title="Excluir categoria">${TRASH_SVG}</button>
          <button type="button" class="crm-qrp-cat-section-toggle crm-qrp-cat-section-caret-btn" data-toggle-collapse="${cat.id}">
            ${collapsed ? DOWN_SVG : UP_SVG}
          </button>
        </div>
        ${collapsed ? "" : `<div class="crm-qrp-list">${items.map((q) => rowHtml(q, { bgColor: rowBg })).join("")}</div>`}
      </div>`;
    }

    function renderList() {
      if (activePanelKind !== "qr" || !panel.isConnected) return;
      mode = "list";

      const filtersHtml = quickReplies.length || quickReplyCategories.length
        ? `<div class="crm-qrp-filters">
            <button class="crm-qrp-filter-chip ${filterMode === "all" ? "is-active" : ""}" data-filter-all>Todas</button>
            <button class="crm-qrp-filter-chip crm-qrp-filter-fav ${filterMode === "fav" ? "is-active" : ""}" data-filter-fav>${STAR_FILLED_SVG} Favoritas</button>
            <button class="crm-qrp-filter-chip ${filterMode === "none" ? "is-active" : ""}" data-filter-none>Sem categoria</button>
            <button class="crm-qrp-filter-chip ${filterMode === "cat" ? "is-active" : ""}" data-filter-by-cat>${TAG_SVG} Por categoria</button>
          </div>`
        : "";

      let bodyHtml;
      if (filterMode === "fav") {
        // Favoritas cruzam categorias — lista simples (com a etiqueta da
        // categoria no rótulo, já que aqui não tem o bloco agrupando).
        const visible = quickReplies.filter((q) => q.is_favorite);
        bodyHtml = visible.length
          ? `<div class="crm-qrp-list">${visible.map((q) => rowHtml(q, { showCategoryBadge: true })).join("")}</div>`
          : `<p class="crm-qrp-empty">Nenhuma resposta favoritada ainda.</p>`;
      } else if (filterMode === "none") {
        const visible = quickReplies.filter((q) => !q.category_id);
        bodyHtml = visible.length
          ? `<div class="crm-qrp-list">${visible.map((q) => rowHtml(q)).join("")}</div>`
          : `<p class="crm-qrp-empty">Todas as respostas já têm categoria.</p>`;
      } else {
        // "all" (todas as categorias, cada uma como bloco) ou "cat"
        // (só as categorias escolhidas no popup "Por categoria").
        const catsToShow =
          filterMode === "cat"
            ? quickReplyCategories.filter((c) => filterCategoryIds.includes(c.id))
            : quickReplyCategories;
        const sections = catsToShow
          .map((c) => categorySectionHtml(c, quickReplies.filter((q) => q.category_id === c.id)))
          .join("");
        const uncategorized = filterMode === "all" ? quickReplies.filter((q) => !q.category_id) : [];
        const uncategorizedHtml = uncategorized.length
          ? `<div class="crm-qrp-list">${uncategorized.map((q) => rowHtml(q)).join("")}</div>`
          : "";
        bodyHtml =
          sections || uncategorizedHtml
            ? sections + uncategorizedHtml
            : quickReplies.length
              ? `<p class="crm-qrp-empty">Nenhuma resposta nas categorias escolhidas.</p>`
              : `<p class="crm-qrp-empty">Nenhuma resposta cadastrada ainda. Clica em "+ Nova" pra criar a primeira.</p>`;
      }

      panel.innerHTML = `
        <div class="crm-qrp-head">
          <div class="crm-qr-mark">${BOLT_SVG}</div>
          <p class="crm-qrp-title">Respostas rápidas</p>
          <button class="crm-qrp-new" data-new>+ Nova</button>
          <button class="crm-qrp-close" data-close title="Fechar">&times;</button>
        </div>
        ${panelSwitcherHtml("qr")}
        ${filtersHtml}
        <div class="crm-qrp-body">${bodyHtml}</div>
      `;
    }

    function stepFieldsHtml(s, i) {
      if (s.type === "text") {
        return `<textarea class="crm-qrp-textarea" data-step-field="text" data-i="${i}" placeholder="Digite a mensagem…">${escapeHtml(s.text || "")}</textarea>
          <div class="crm-qrp-vars">
            ${QUICK_REPLY_VARIABLES.map((v) => `<button type="button" class="crm-qrp-var-chip" data-insert-var="{${v.key}}" data-target-i="${i}" title="${escapeHtml(v.label)}">{${v.key}}</button>`).join("")}
          </div>`;
      }
      if (s.type === "image" || s.type === "video" || s.type === "audio") {
        const fileLabel = s._uploading ? "Enviando..." : s.filename ? s.filename : "Nenhum arquivo escolhido";
        // Visualizar a mídia aqui dava um loop de tentativas travando o
        // navegador quando o download falhava (sem forma de detectar isso
        // e desistir) — por pedido, fica só o nome do arquivo mesmo.
        return `
          <div class="crm-qrp-file-row">
            <label class="crm-qrp-file-btn">
              ${s.url ? "Trocar arquivo" : "Escolher arquivo"}
              <input type="file" accept="${s.type}/*" data-step-file="${i}" hidden ${s._uploading ? "disabled" : ""} />
            </label>
            <span class="crm-qrp-file-name">${escapeHtml(fileLabel)}</span>
          </div>
          ${s.type !== "audio" ? `<input class="crm-qrp-input" data-step-field="caption" data-i="${i}" value="${escapeHtml(s.caption || "")}" placeholder="Legenda (opcional)" />` : ""}
        `;
      }
      if (s.type === "funnel_add") {
        const funnel = funnels.find((f) => f.id === s.funnel_id);
        return `
          <select class="crm-qrp-select" data-step-field="funnel_id" data-i="${i}">
            <option value="">Escolher funil…</option>
            ${funnels
              .filter((f) => f.mode !== "label")
              .map((f) => `<option value="${escapeHtml(f.id)}" ${f.id === s.funnel_id ? "selected" : ""}>${escapeHtml(f.name)}</option>`)
              .join("")}
          </select>
          <select class="crm-qrp-select" data-step-field="stage_id" data-i="${i}">
            <option value="">Escolher etapa…</option>
            ${(funnel?.stages || [])
              .map((st) => `<option value="${escapeHtml(st.id)}" ${st.id === s.stage_id ? "selected" : ""}>${escapeHtml(st.name)}</option>`)
              .join("")}
          </select>
        `;
      }
      if (s.type === "funnel_remove") {
        return `
          <select class="crm-qrp-select" data-step-field="funnel_id" data-i="${i}">
            <option value="">Escolher funil…</option>
            ${funnels
              .filter((f) => f.mode !== "label")
              .map((f) => `<option value="${escapeHtml(f.id)}" ${f.id === s.funnel_id ? "selected" : ""}>${escapeHtml(f.name)}</option>`)
              .join("")}
          </select>
        `;
      }
      return "";
    }

    function stepCardHtml(s, i, total) {
      const showDelay = ["text", "image", "video", "audio"].includes(s.type);
      return `
        <div class="crm-qrp-step">
          <div class="crm-qrp-step-head">
            <span class="crm-qrp-step-num">${i + 1}</span>
            <select class="crm-qrp-step-type" data-step-type="${i}">
              ${QR_STEP_TYPES.map((t) => `<option value="${t.type}" ${t.type === s.type ? "selected" : ""}>${t.label}</option>`).join("")}
            </select>
            <button class="crm-qrp-icon" data-move-step="${i}" data-dir="-1" title="Mover pra cima" ${i === 0 ? "disabled" : ""}>${UP_SVG}</button>
            <button class="crm-qrp-icon" data-move-step="${i}" data-dir="1" title="Mover pra baixo" ${i === total - 1 ? "disabled" : ""}>${DOWN_SVG}</button>
            <button class="crm-qrp-icon crm-qrp-icon-danger" data-del-step="${i}" title="Remover passo">${TRASH_SVG}</button>
          </div>
          <div class="crm-qrp-step-body">${stepFieldsHtml(s, i)}</div>
          ${showDelay ? `
          <label class="crm-qrp-delay">
            Aguardar
            <input class="crm-qrp-delay-input" type="number" min="0" max="120" data-step-field="delay_seconds" data-i="${i}" value="${s.delay_seconds ?? ""}" placeholder="0" />
            segundos antes do próximo passo
          </label>` : ""}
        </div>
      `;
    }

    function renderForm(reply) {
      mode = "form";
      editingId = reply?.id || null;
      steps = reply ? JSON.parse(JSON.stringify(reply.actions || [])) : [{ type: "text", text: "", delay_seconds: 5 }];
      favoriteValue = !!reply?.is_favorite;
      paintForm(reply?.title || "", reply?.category_id || "", reply?.shortcut || "");
    }

    function paintForm(titleValue, categoryIdValue, shortcutValue) {
      panel.innerHTML = `
        <div class="crm-qrp-head" style="border-bottom:1px solid var(--z-line-soft)">
          <button class="crm-qrp-back" data-back title="Voltar">&larr;</button>
          <input class="crm-qrp-title-input" data-field="title" value="${escapeHtml(titleValue)}" placeholder="Nome da resposta" maxlength="120" />
          <button class="crm-qrp-icon crm-qrp-fav-toggle ${favoriteValue ? "is-fav" : ""}" data-fav-toggle title="${favoriteValue ? "Remover dos favoritos" : "Favoritar"}">${favoriteValue ? STAR_FILLED_SVG : STAR_OUTLINE_SVG}</button>
          <button class="crm-qrp-close" data-close title="Fechar">&times;</button>
        </div>
        <div class="crm-qrp-body">
          <div class="crm-qrp-meta-row">
            <label class="crm-qrp-meta-field">
              <span>Categoria</span>
              <select class="crm-qrp-select" data-field="category_id">
                <option value="">Sem categoria</option>
                ${quickReplyCategories.map((c) => `<option value="${c.id}" ${c.id === categoryIdValue ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
              </select>
            </label>
            <label class="crm-qrp-meta-field">
              <span>Atalho (opcional)</span>
              <div class="crm-qrp-shortcut-wrap">
                <span class="crm-qrp-shortcut-prefix">/</span>
                <input class="crm-qrp-input crm-qrp-shortcut-input" data-field="shortcut" value="${escapeHtml(shortcutValue || "")}" placeholder="ex: orcamento" maxlength="30" />
              </div>
            </label>
          </div>
          <p class="crm-qrp-shortcut-hint">${shortcutValue ? `Digite <b>/${escapeHtml(shortcutValue)}</b> na caixa de mensagem do WhatsApp pra usar essa resposta direto.` : "Defina um atalho pra poder chamar essa resposta digitando /atalho na caixa de mensagem."}</p>
          <div class="crm-qrp-steps">${steps.map((s, i) => stepCardHtml(s, i, steps.length)).join("")}</div>
          <button class="crm-qrp-add-step" data-add-step>+ Adicionar passo</button>
        </div>
        <div class="crm-qrp-foot">
          <button class="crm-qrp-save" data-save ${savingFile ? "disabled" : ""}>${editingId ? "Salvar" : "Criar resposta"}</button>
        </div>
      `;
    }

    function currentTitle() {
      return panel.querySelector('[data-field="title"]')?.value.trim() || "";
    }
    function currentCategoryId() {
      return panel.querySelector('[data-field="category_id"]')?.value.trim() || "";
    }
    function currentShortcut() {
      return panel.querySelector('[data-field="shortcut"]')?.value.trim() || "";
    }

    renderList();
    void loadQuickReplies().then(() => {
      if (mode === "list") renderList();
    });
    void loadQuickReplyCategories().then(() => {
      if (mode === "list") renderList();
    });

    panelClickHandler = async (e) => {
      if (e.target.closest("[data-close]")) return closeSharedPanel();
      const sw = e.target.closest("[data-switch]");
      if (sw) return void openSharedPanel(sw.getAttribute("data-switch"));
      if (e.target.closest("[data-back]")) return renderList();

      // Botão único "+ Nova" — pergunta se é categoria ou resposta, em vez
      // de dois botões separados no cabeçalho.
      const newBtn = e.target.closest("[data-new]");
      if (newBtn) {
        openMenu(newBtn, [
          {
            label: "+ Nova categoria",
            onClick: () => {
              void openCategoryEditPopup(newBtn, null).then(() => renderList());
            },
          },
          { label: "+ Nova resposta", onClick: () => renderForm(null) },
        ]);
        return;
      }

      if (e.target.closest("[data-filter-all]")) {
        filterMode = "all";
        filterCategoryIds = [];
        return renderList();
      }
      if (e.target.closest("[data-filter-fav]")) {
        filterMode = filterMode === "fav" ? "all" : "fav";
        filterCategoryIds = [];
        return renderList();
      }
      if (e.target.closest("[data-filter-none]")) {
        filterMode = filterMode === "none" ? "all" : "none";
        filterCategoryIds = [];
        return renderList();
      }
      const filterByCatBtn = e.target.closest("[data-filter-by-cat]");
      if (filterByCatBtn) {
        openCategoryFilterPopup(filterByCatBtn);
        return;
      }
      // Lápis/lixeira no próprio bloco colorido da categoria — o popup de
      // editar abre ancorado NESSE botão, então aparece perto do bloco
      // (não em outro canto da tela).
      const editCatSection = e.target.closest("[data-edit-cat-section]");
      if (editCatSection) {
        const cat = quickReplyCategories.find((c) => c.id === editCatSection.getAttribute("data-edit-cat-section"));
        if (!cat) return;
        const updated = await openCategoryEditPopup(editCatSection, cat);
        if (updated) renderList();
        return;
      }
      const delCatSection = e.target.closest("[data-del-cat-section]");
      if (delCatSection) {
        const cat = quickReplyCategories.find((c) => c.id === delCatSection.getAttribute("data-del-cat-section"));
        if (!cat) return;
        const ok = await openConfirmPop(delCatSection, {
          text: `Excluir "${cat.name}"? As respostas dela ficam sem categoria.`,
          confirmLabel: "Sim, excluir",
        });
        if (!ok) return;
        await chrome.runtime
          .sendMessage({ type: "api", path: `/api/public/extension/quick-reply-categories/${cat.id}`, opts: { method: "DELETE" } })
          .catch(() => null);
        filterCategoryIds = filterCategoryIds.filter((x) => x !== cat.id);
        filterMode = filterCategoryIds.length ? "cat" : "all";
        await loadQuickReplyCategories();
        await loadQuickReplies();
        renderList();
        return;
      }
      // Clicar no cabeçalho colorido de uma categoria dobra/desdobra o
      // bloco dela (as respostas continuam ali, só ficam escondidas).
      const toggleCollapse = e.target.closest("[data-toggle-collapse]");
      if (toggleCollapse) {
        const id = toggleCollapse.getAttribute("data-toggle-collapse");
        if (collapsedCategoryIds.has(id)) collapsedCategoryIds.delete(id);
        else collapsedCategoryIds.add(id);
        return renderList();
      }

      // Favoritar direto na lista, sem precisar abrir a resposta pra editar.
      const favBtn = e.target.closest("[data-fav]");
      if (favBtn) {
        const reply = quickReplies.find((q) => q.id === favBtn.getAttribute("data-fav"));
        if (!reply) return;
        const next = !reply.is_favorite;
        reply.is_favorite = next; // otimista — já reflete na tela antes da resposta do servidor
        renderList();
        const r = await chrome.runtime
          .sendMessage({
            type: "api",
            path: `/api/public/extension/quick-replies/${reply.id}`,
            opts: { method: "PATCH", body: JSON.stringify({ is_favorite: next }) },
          })
          .catch(() => null);
        if (!r?.ok) {
          reply.is_favorite = !next; // desfaz se der erro
          renderList();
          crmToast(r?.error || "Não consegui favoritar.", "err");
        }
        return;
      }

      // Favoritar dentro do próprio formulário (some junto no salvar).
      if (e.target.closest("[data-fav-toggle]")) {
        favoriteValue = !favoriteValue;
        paintForm(currentTitle(), currentCategoryId(), currentShortcut());
        return;
      }

      // Insere {nome}/{telefone}/etc no textarea do passo, na posição do
      // cursor — sem repintar o formulário inteiro (perderia o foco).
      const varChip = e.target.closest("[data-insert-var]");
      if (varChip) {
        const i = Number(varChip.getAttribute("data-target-i"));
        const varText = varChip.getAttribute("data-insert-var");
        const textarea = panel.querySelector(`[data-step-field="text"][data-i="${i}"]`);
        if (textarea && steps[i]) {
          const start = textarea.selectionStart ?? textarea.value.length;
          const end = textarea.selectionEnd ?? textarea.value.length;
          const newValue = textarea.value.slice(0, start) + varText + textarea.value.slice(end);
          textarea.value = newValue;
          steps[i].text = newValue;
          textarea.focus();
          const newPos = start + varText.length;
          textarea.setSelectionRange(newPos, newPos);
        }
        return;
      }

      const editBtn = e.target.closest("[data-edit]");
      if (editBtn) return renderForm(quickReplies.find((q) => q.id === editBtn.getAttribute("data-edit")));

      const delBtn = e.target.closest("[data-del]");
      if (delBtn) {
        const reply = quickReplies.find((q) => q.id === delBtn.getAttribute("data-del"));
        if (!reply) return;
        const ok = await openConfirmPop(delBtn, {
          text: `Tem certeza que quer excluir "${reply.title}"?`,
          confirmLabel: "Sim, excluir",
        });
        if (!ok) return;
        const r = await chrome.runtime
          .sendMessage({ type: "api", path: `/api/public/extension/quick-replies/${reply.id}`, opts: { method: "DELETE" } })
          .catch(() => null);
        if (r?.ok) {
          crmToast("Resposta excluída", "ok", delBtn);
          await loadQuickReplies();
          renderList();
        } else {
          crmToast(r?.error || "Não consegui excluir.", "err", delBtn);
        }
        return;
      }

      // Envia sem fechar o painel — o usuário pode disparar várias
      // respostas seguidas durante o atendimento sem reabrir toda vez.
      const send = e.target.closest("[data-send]");
      if (send && !quickReplySending) {
        const reply = quickReplies.find((q) => q.id === send.getAttribute("data-send"));
        if (!reply) return;
        quickReplySending = true;
        send.disabled = true;
        const chat = await activeChat();
        if (!chat) {
          crmToast("Não consegui ler a conversa aberta.", "err");
          quickReplySending = false;
          send.disabled = false;
          return;
        }
        try {
          await sendQuickReply(reply, chat);
        } finally {
          quickReplySending = false;
          send.disabled = false;
        }
        return;
      }

      if (mode !== "form") return;

      const addStep = e.target.closest("[data-add-step]");
      if (addStep) {
        steps.push({ type: "text", text: "", delay_seconds: 5 });
        paintForm(currentTitle(), currentCategoryId(), currentShortcut());
        return;
      }

      const delStep = e.target.closest("[data-del-step]");
      if (delStep) {
        steps.splice(Number(delStep.getAttribute("data-del-step")), 1);
        if (!steps.length) steps.push({ type: "text", text: "", delay_seconds: 5 });
        paintForm(currentTitle(), currentCategoryId(), currentShortcut());
        return;
      }

      const moveStep = e.target.closest("[data-move-step]");
      if (moveStep && !moveStep.disabled) {
        const i = Number(moveStep.getAttribute("data-move-step"));
        const dir = Number(moveStep.getAttribute("data-dir"));
        const j = i + dir;
        if (j >= 0 && j < steps.length) {
          [steps[i], steps[j]] = [steps[j], steps[i]];
          paintForm(currentTitle(), currentCategoryId(), currentShortcut());
        }
        return;
      }

      const saveBtn = e.target.closest("[data-save]");
      if (saveBtn) {
        const title = currentTitle();
        if (!title) { crmToast("Dá um nome pra essa resposta.", "err"); return; }
        const cleaned = steps
          .map((s) => {
            const out = { type: s.type, delay_seconds: s.delay_seconds };
            if (s.type === "text") out.text = (s.text || "").trim();
            if (["image", "video", "audio"].includes(s.type)) {
              out.path = s.path;
              out.mime = s.mime;
              out.filename = s.filename;
              if (s.caption) out.caption = s.caption;
            }
            if (s.type === "funnel_add") { out.funnel_id = s.funnel_id; out.stage_id = s.stage_id; }
            if (s.type === "funnel_remove") out.funnel_id = s.funnel_id;
            return out;
          })
          .filter((s) => {
            if (s.type === "text") return !!s.text;
            if (s.type === "funnel_add") return !!s.funnel_id && !!s.stage_id;
            if (s.type === "funnel_remove") return !!s.funnel_id;
            return !!s.path;
          });
        if (!cleaned.length) { crmToast("Preenche pelo menos um passo válido.", "err"); return; }
        const shortcutValue = currentShortcut();
        if (shortcutValue && /\s/.test(shortcutValue)) {
          crmToast("O atalho não pode ter espaços.", "err");
          return;
        }
        saveBtn.disabled = true;
        saveBtn.textContent = "Salvando...";
        const body = JSON.stringify({
          title,
          actions: cleaned,
          category_id: currentCategoryId() || null,
          shortcut: shortcutValue || null,
          is_favorite: favoriteValue,
        });
        const path = editingId ? `/api/public/extension/quick-replies/${editingId}` : "/api/public/extension/quick-replies";
        const method = editingId ? "PATCH" : "POST";
        const r = await chrome.runtime.sendMessage({ type: "api", path, opts: { method, body } }).catch(() => null);
        if (r?.ok) {
          crmToast(editingId ? "Resposta atualizada" : "Resposta criada");
          await loadQuickReplies();
          renderList();
        } else {
          crmToast(r?.error || "Não consegui salvar.", "err");
          saveBtn.disabled = false;
          saveBtn.textContent = editingId ? "Salvar" : "Criar resposta";
        }
        return;
      }
    };

    panelChangeHandler = async (e) => {
      const typeSel = e.target.closest("[data-step-type]");
      if (typeSel) {
        const i = Number(typeSel.getAttribute("data-step-type"));
        // Passo novo já nasce com 5s de espera (padrão pedido); mídia
        // e texto usam, funil ignora (não mostra esse campo).
        steps[i] = { type: typeSel.value, delay_seconds: 5 };
        paintForm(currentTitle(), currentCategoryId(), currentShortcut());
        return;
      }
      const field = e.target.closest("[data-step-field]");
      if (field) {
        const i = Number(field.getAttribute("data-i"));
        const key = field.getAttribute("data-step-field");
        if (key === "delay_seconds") {
          const v = field.value === "" ? undefined : Math.max(0, Math.min(120, Number(field.value)));
          steps[i].delay_seconds = v;
        } else {
          steps[i][key] = field.value;
        }
        if (key === "funnel_id" && steps[i].type === "funnel_add") {
          steps[i].stage_id = "";
          paintForm(currentTitle(), currentCategoryId(), currentShortcut());
        }
        return;
      }
      const fileInput = e.target.closest("[data-step-file]");
      if (fileInput) {
        const i = Number(fileInput.getAttribute("data-step-file"));
        const file = fileInput.files?.[0];
        if (!file) return;
        steps[i]._uploading = true;
        savingFile = true;
        paintForm(currentTitle(), currentCategoryId(), currentShortcut());
        try {
          const dataUrl = await fileToBase64(file);
          const r = await chrome.runtime
            .sendMessage({
              type: "api",
              path: "/api/public/extension/quick-replies/upload",
              opts: { method: "POST", body: JSON.stringify({ filename: file.name, mime: file.type, data_base64: dataUrl }) },
            })
            .catch(() => null);
          if (r?.ok) {
            steps[i] = {
              ...steps[i],
              path: r.path,
              url: r.url,
              mime: r.mime,
              filename: r.filename,
              _uploading: false,
            };
            crmToast("Arquivo enviado");
          } else {
            steps[i]._uploading = false;
            crmToast(r?.error || "Não consegui enviar o arquivo.", "err");
          }
        } catch (err) {
          steps[i]._uploading = false;
          crmToast(err?.message || "Não consegui ler o arquivo.", "err");
        } finally {
          savingFile = false;
          paintForm(currentTitle(), currentCategoryId(), currentShortcut());
        }
      }
    };

    panelInputHandler = (e) => {
      const field = e.target.closest("[data-step-field]");
      if (field && field.tagName !== "SELECT") {
        const i = Number(field.getAttribute("data-i"));
        const key = field.getAttribute("data-step-field");
        if (key === "delay_seconds") {
          steps[i].delay_seconds = field.value === "" ? undefined : Number(field.value);
        } else {
          steps[i][key] = field.value;
        }
      }
    };
  }


  async function sendQuickReply(reply, chat) {
    // O alvo correto é o próprio ID da conversa (wa_id). Usar só os dígitos do
    // @lid fazia o bridge montar um telefone inexistente e o envio falhava.
    const waId = chat.wa_id || null;
    const target = chat.phone || String(waId || "").split("@")[0];
    if (!target && !waId) return crmToast("Contato sem telefone.", "err");
    const sendable = (reply.actions || []).filter((a) =>
      ["text", "image", "video", "audio"].includes(a.type),
    );
    let res = { ok: true };
    if (sendable.length) {
      const prefetched = await chrome.runtime
        .sendMessage({ type: "prefetch_media", actions: sendable })
        .catch(() => null);
      res = await handleWaAction({
        phone: target,
        waId,
        name: chat.name || "",
        actions: prefetched?.ok ? prefetched.actions : sendable,
      });
      // Sem confirmação de envio: só avisa quando falha.
      if (!res?.ok) crmToast(res?.error || "Falha ao enviar", "err");
    }
    // Passos de "mover/remover no funil" — mesma coisa que o CRM já fazia,
    // agora também acontece disparando pelo WhatsApp.
    if (res?.ok) await applyQuickReplyFunnelActions(reply, chat);
  }

  /** Aplica os passos de funil (mover/remover) de uma resposta rápida
   * depois do envio — espelha o que o CRM já faz ao disparar por lá. */
  async function applyQuickReplyFunnelActions(reply, chat) {
    const list = (reply.actions || []).filter((a) => a.type === "funnel_add" || a.type === "funnel_remove");
    if (!list.length) return;
    await loadFunnels();
    for (const a of list) {
      if (a.type === "funnel_add" && a.funnel_id && a.stage_id) {
        await chrome.runtime
          .sendMessage({
            type: "api",
            path: "/api/public/extension/funnel-cards",
            opts: {
              method: "POST",
              body: JSON.stringify({
                funnel_id: a.funnel_id,
                stage_id: a.stage_id,
                title: chat.name || chat.phone || "Contato",
                phone: chat.phone || null,
                wa_contact_id: chat.contact_db_id || null,
              }),
            },
          })
          .catch(() => null);
      } else if (a.type === "funnel_remove" && a.funnel_id) {
        const funnel = funnels.find((f) => f.id === a.funnel_id);
        const matches = (funnel?.cards || []).filter(
          (c) => (chat.wa_id && c.wa_id === chat.wa_id) || (chat.phone && c.phone === chat.phone),
        );
        for (const c of matches) {
          await chrome.runtime
            .sendMessage({ type: "api", path: "/api/public/extension/funnel-cards", opts: { method: "DELETE", body: JSON.stringify({ id: c.id }) } })
            .catch(() => null);
        }
      }
    }
    await loadFunnels();
    updateFunnelBadge();
    updateFollowupBadge();
    updateNotesBadge();
    updateScheduleBadge();
  }

  // ── Atalho "/palavra" na caixa de mensagem do WhatsApp ──────────────────
  // Digitar "/" seguido de uma palavra que bate com o atalho de alguma
  // resposta rápida abre uma listinha flutuante ali mesmo, sem precisar
  // clicar no ícone do raio. Selecionar (clique, Enter ou Tab) limpa o que
  // foi digitado e dispara a resposta na hora.
  let shortcutComposeBox = null; // <div contenteditable> da conversa atual, ou null
  let shortcutPicker = null; // { el, matches, selectedIndex } enquanto a listinha está aberta

  function findComposeBox() {
    const footer = document.querySelector("#main footer");
    return footer?.querySelector('div[contenteditable="true"]') || null;
  }

  /** Se o texto da caixa é exatamente "/algumacoisa" (sem espaço), devolve
   * "algumacoisa" (pode ser vazio, logo depois de digitar só "/"). Fora
   * desse padrão (sem "/", com espaço, texto normal), devolve null. */
  function extractShortcutFragment(box) {
    const text = (box.textContent || "").trim();
    const m = text.match(/^\/(\S*)$/);
    return m ? m[1] : null;
  }

  function ensureShortcutListener() {
    const box = findComposeBox();
    if (box === shortcutComposeBox) return; // mesma caixa de sempre, nada a fazer
    // Trocou de conversa (ou a caixa foi recriada) — a listinha antiga não
    // faz mais sentido nesse contexto novo.
    closeShortcutPicker();
    shortcutComposeBox = box;
    if (box) box.addEventListener("input", onShortcutComposeInput);
  }

  function onShortcutComposeInput() {
    const box = shortcutComposeBox;
    if (!box) return;
    const fragment = extractShortcutFragment(box);
    if (fragment === null) return closeShortcutPicker();
    const frag = fragment.toLowerCase();
    const matches = quickReplies.filter((q) => q.shortcut && q.shortcut.toLowerCase().startsWith(frag)).slice(0, 8);
    if (!matches.length) return closeShortcutPicker();
    openShortcutPicker(matches);
  }

  function openShortcutPicker(matches) {
    if (!shortcutPicker) {
      const el = document.createElement("div");
      el.className = "crm-qr-shortcut-pop";
      document.body.appendChild(el);
      shortcutPicker = { el, matches: [], selectedIndex: 0 };
      // mousedown (não click): dispara antes da caixa de mensagem perder o
      // foco, evitando qualquer efeito colateral do WhatsApp nessa troca.
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const item = e.target.closest("[data-shortcut-pick]");
        if (item) void confirmShortcutPick(Number(item.getAttribute("data-shortcut-pick")));
      });
    }
    shortcutPicker.matches = matches;
    shortcutPicker.selectedIndex = Math.min(shortcutPicker.selectedIndex, matches.length - 1);
    paintShortcutPicker();
  }

  function paintShortcutPicker() {
    if (!shortcutPicker || !shortcutComposeBox) return;
    const rect = shortcutComposeBox.getBoundingClientRect();
    shortcutPicker.el.style.left = `${Math.min(Math.max(8, rect.left), window.innerWidth - 280)}px`;
    shortcutPicker.el.style.top = `${rect.top - 8}px`;
    shortcutPicker.el.innerHTML = shortcutPicker.matches
      .map(
        (q, i) => `<div class="crm-qr-shortcut-item ${i === shortcutPicker.selectedIndex ? "is-active" : ""}" data-shortcut-pick="${i}">
          <span class="crm-qr-shortcut-item-cmd">/${escapeHtml(q.shortcut)}</span>
          <span class="crm-qr-shortcut-item-title">${escapeHtml(q.title)}</span>
        </div>`,
      )
      .join("");
  }

  function closeShortcutPicker() {
    if (!shortcutPicker) return;
    shortcutPicker.el.remove();
    shortcutPicker = null;
  }

  function clearComposeBox(box) {
    // document.execCommand ainda funciona pra isso e, ao contrário de
    // simplesmente zerar textContent, dispara os eventos que o React do
    // WhatsApp espera pra atualizar o próprio estado interno da caixa.
    box.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
  }

  async function confirmShortcutPick(index) {
    const reply = shortcutPicker?.matches?.[index];
    const box = shortcutComposeBox;
    closeShortcutPicker();
    if (!reply || !box) return;
    clearComposeBox(box);
    const chat = await activeChat();
    if (!chat) return crmToast("Não consegui ler a conversa aberta.", "err");
    await sendQuickReply(reply, chat);
  }

  // Registrado uma vez só, no document, em fase de captura — assim
  // intercepta Enter/Tab/setas ANTES do próprio WhatsApp decidir enviar a
  // mensagem com o "/atalho" ainda digitado. Filtra pelo alvo pra só agir
  // quando o evento é mesmo da caixa de digitar da conversa atual.
  document.addEventListener(
    "keydown",
    (e) => {
      if (!shortcutPicker || e.target !== shortcutComposeBox) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        shortcutPicker.selectedIndex = Math.min(shortcutPicker.selectedIndex + 1, shortcutPicker.matches.length - 1);
        paintShortcutPicker();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        shortcutPicker.selectedIndex = Math.max(shortcutPicker.selectedIndex - 1, 0);
        paintShortcutPicker();
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        void confirmShortcutPick(shortcutPicker.selectedIndex);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeShortcutPicker();
      }
    },
    true,
  );

  // Clicar fora da listinha (sem ser na própria caixa de digitar) fecha
  // ela, do mesmo jeito que os outros popups da extensão funcionam.
  document.addEventListener(
    "mousedown",
    (e) => {
      if (!shortcutPicker) return;
      if (shortcutPicker.el.contains(e.target) || e.target === shortcutComposeBox) return;
      closeShortcutPicker();
    },
    true,
  );

  // Modal próprio do CRM — nada de confirm()/alert() nativos do navegador.
  function crmConfirm({ title, body: text, confirmLabel = "Confirmar", cancelLabel = "Cancelar" }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "crm-modal-overlay";
      overlay.innerHTML = `
        <div class="crm-modal" role="dialog" aria-modal="true">
          <p class="crm-modal-title">${escapeHtml(title)}</p>
          ${text ? `<p class="crm-modal-body">${escapeHtml(text)}</p>` : ""}
          <div class="crm-modal-actions">
            <button class="crm-modal-cancel">${escapeHtml(cancelLabel)}</button>
            <button class="crm-modal-confirm">${escapeHtml(confirmLabel)}</button>
          </div>
        </div>
      `;
      const close = (value) => { overlay.remove(); resolve(value); };
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });
      overlay.querySelector(".crm-modal-cancel").addEventListener("click", () => close(false));
      overlay.querySelector(".crm-modal-confirm").addEventListener("click", () => close(true));
      document.body.appendChild(overlay);
    });
  }

  /** Prompt próprio do CRM (nome de aba etc.). */
  function crmPrompt({ title, value = "", confirmLabel = "Salvar" }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "crm-modal-overlay";
      overlay.innerHTML = `
        <div class="crm-modal" role="dialog" aria-modal="true">
          <p class="crm-modal-title">${escapeHtml(title)}</p>
          <input class="crm-modal-input" value="${escapeHtml(value)}" />
          <div class="crm-modal-actions">
            <button class="crm-modal-cancel">Cancelar</button>
            <button class="crm-modal-confirm">${escapeHtml(confirmLabel)}</button>
          </div>
        </div>
      `;
      const input = overlay.querySelector(".crm-modal-input");
      const close = (v) => { overlay.remove(); resolve(v); };
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
      overlay.querySelector(".crm-modal-cancel").addEventListener("click", () => close(null));
      overlay.querySelector(".crm-modal-confirm").addEventListener("click", () => close(input.value.trim() || null));
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") close(input.value.trim() || null); });
      document.body.appendChild(overlay);
      setTimeout(() => input.focus(), 30);
    });
  }

  function escapeHtml(value) {

    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Envio silencioso via wa-bridge (MAIN world).
  const pending = new Map();
  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.__crm !== "action_done_v339") return;
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    clearTimeout(p.timeout);
    p.resolve({ ok: !!d.ok, error: d.error });
  });

  function bridgeRequest(payload, timeoutMs = 180000) {
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, error: "Timeout na ação do WhatsApp" });
      }, timeoutMs);
      pending.set(id, { resolve, timeout });
      window.postMessage({ ...payload, id }, "*");
    });
  }

  // Ação vinda do painel: abrir conversa, enviar texto ou resposta rápida.
  async function handleWaAction(action) {
    const phone = action?.phone;
    const waId = action?.waId || null;
    if (!phone && !waId) return { ok: false, error: "Contato inválido" };
    try {
      await ensureWaScriptsInjected();
    } catch (e) {
      return { ok: false, error: `Falha ao carregar wa-js/bridge: ${String(e?.message || e)}` };
    }
    const vars = {
      nome: action?.name || "",
      primeiro_nome: String(action?.name || "").trim().split(/\s+/)[0] || "",
      telefone: action?.phone || "",
    };
    const fill = (t) => String(t || "").replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));

    const actions = [];
    if (!action.openOnly) {
      if (Array.isArray(action.actions) && action.actions.length) {
        for (const a of action.actions) {
          actions.push({
            type: a.type,
            text: fill(a.text),
            caption: fill(a.caption),
            url: a.url || null,
            filename: a.filename || null,
            mime: a.mime || null,
            // Mídia já baixada pelo service worker (a página do WhatsApp
            // bloqueia fetch externo por CSP).
            data_base64: a.data_base64 || null,
            // Tempo de espera configurado nesse passo — estava se perdendo
            // aqui (o objeto era remontado campo a campo e esse não tinha
            // sido copiado), por isso o temporizador não fazia efeito.
            delay_seconds: typeof a.delay_seconds === "number" ? a.delay_seconds : null,
          });
        }
      } else if (action.text) {
        actions.push({ type: "text", text: fill(action.text) });
      }
    }

    return bridgeRequest({
      // Protocolo versionado: bridges de versões antigas que ainda estejam
      // vivos na aba não reconhecem esta ação e não duplicam o envio.
      __crm: "action_v342",
      phone,
      waId,
      openOnly: !!action.openOnly,
      actions,
    });
  }


  async function handleSend(job) {
    const phone = job?.customer?.phone;
    const text = job?.body;
    const sourceActions = Array.isArray(job?.actions) ? job.actions : [];
    if (!phone || (!text && !sourceActions.length)) return { ok: false, error: "Job inválido" };
    try {
      await ensureWaScriptsInjected();
    } catch (e) {
      return { ok: false, error: `Falha ao carregar wa-js/bridge: ${String(e?.message || e)}` };
    }
    const sendable = sourceActions.filter((action) => ["text", "image", "video", "audio"].includes(action?.type));
    const silent = sendable.length
      ? await handleWaAction({ phone, name: job?.customer?.name || "", actions: sendable })
      : await handleWaAction({ phone, name: job?.customer?.name || "", actions: [{ type: "text", text }] });

    if (silent?.ok) return silent;
    return { ok: false, error: silent?.error || "Envio silencioso falhou" };
  }
})();
