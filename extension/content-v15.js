// Content script v0.25.0 — abas do CRM no topo do WhatsApp Web + trilho de
// ícones minimalista à esquerda. Clicar numa aba/lista filtra a própria
// lista de conversas do WhatsApp (não abre o CRM).

(function () {
  const CRM_VERSION = "0.35.22";
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
    }
  }

  async function loadQuickReplies() {
    const r = await chrome.runtime
      .sendMessage({ type: "api", path: "/api/public/extension/quick-replies" })
      .catch(() => null);
    if (r?.ok) quickReplies = r.quick_replies || [];
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
    funnel: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h18l-7 8v7l-4 2v-9L3 4z"/></svg>`,
    sync: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>`,
    gear: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7"/></svg>`,
    exit: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>`,
    send: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/></svg>`,
    chat: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 21l1.9-4.9A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z"/></svg>`,
    calendar: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
    badge: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.3 11 14.8l4.5-5"/></svg>`,
    ranking: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="13" width="4.5" height="7" rx="1"/><rect x="9.75" y="9" width="4.5" height="11" rx="1"/><rect x="16" y="4.5" width="4.5" height="15.5" rx="1"/></svg>`,
    robot: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8.5" width="18" height="12.5" rx="2.5"/><path d="M12 8.5V4"/><circle cx="12" cy="2.5" r="1.6"/><circle cx="8.5" cy="14.5" r="1.2"/><circle cx="15.5" cy="14.5" r="1.2"/><path d="M1 12.5v4M23 12.5v4"/></svg>`,
    cap: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M23 9 12 3 1 9l11 6 11-6Z"/><path d="M5 11.5v5c0 1.8 3.1 3.5 7 3.5s7-1.7 7-3.5v-5"/><path d="M23 9v7"/></svg>`,
    link: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 14.5 14.5 9.5"/><path d="M11 5.2 12 4.2a3.6 3.6 0 1 1 5.1 5.1l-1 1"/><path d="M13 18.8 12 19.8a3.6 3.6 0 1 1-5.1-5.1l1-1"/></svg>`,
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
      <div class="crm-rail-mark"><img src="${chrome.runtime.getURL("zetta-z.png")}" alt="Zetta CRM" /></div>
      <button class="crm-rail-btn" data-go="agenda" data-label="Agenda">${ICONS.calendar}</button>
      <button class="crm-rail-btn" data-go="funis" data-label="Funis de Vendas">${ICONS.funnel}</button>
      <button class="crm-rail-btn" data-go="disparo" data-label="Disparo">${ICONS.send}</button>
      <button class="crm-rail-btn" data-go="respostas" data-label="Respostas rápidas">${ICONS.chat}</button>
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
      const filterBtn = e.target.closest(".crm-filter");
      if (filterBtn) return openFilterMenu(filterBtn);

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

      const addBtn = e.target.closest(".crm-pill-add-icon");
      if (addBtn) return createTab();

      const pill = e.target.closest(".crm-pill");
      if (!pill) return;
      const labelId = pill.getAttribute("data-label-id");
      if (labelId) return filterByLabel(labelId, pill.getAttribute("data-name") || "");
      const stageId = pill.getAttribute("data-stage");
      if (stageId) return filterByStage(pill.getAttribute("data-funnel"), stageId);
    });

    renderTopbar();
  }

  function formatBRL(cents) {
    return ((cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  /** Menu flutuante ancorado a um elemento (substitui menus nativos). */
  function openMenu(anchor, items) {
    document.querySelector(".crm-menu")?.remove();
    const rect = anchor.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.className = "crm-menu";
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.left = `${Math.max(8, rect.left)}px`;
    menu.innerHTML = items
      .map(
        (i, idx) =>
          `<button data-i="${idx}"${i.danger ? ' class="crm-menu-danger"' : ""}>${escapeHtml(i.label)}</button>`,
      )
      .join("");
    document.body.appendChild(menu);
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

  /** Nome do filtro ativo (usado no botão da barra). */
  function currentFilterLabel() {
    if (topbarFilter === "labels") return "LISTAS";
    return "FUNIL PRINCIPAL";
  }

  /** Só existem duas opções aqui na barra do WhatsApp: o Funil principal
   * (fixo) e as Listas (etiquetas do WhatsApp). Funis personalizados só
   * são geridos dentro do CRM — aqui é ação rápida do dia a dia. */
  function currentFunnel() {
    return tabFunnel();
  }

  function openFilterMenu(anchor) {
    // Só duas opções aqui — Funil principal e Listas. Funis personalizados
    // continuam existindo, mas só são geridos dentro do CRM.
    openMenu(anchor, [
      { label: "FUNIL PRINCIPAL", onClick: () => setTopbarFilter("tabs") },
      { label: "LISTAS", onClick: () => setTopbarFilter("labels") },
    ]);
  }

  // ---------------------------------------------------------------------
  // Listas e etapas de funil funcionais dentro do WhatsApp:
  // clicar numa pílula abre a gaveta com os contatos daquele grupo e ainda
  // tenta aplicar o filtro nativo da lista de conversas.
  // ---------------------------------------------------------------------
  let activeFilter = null; // { key, kind, id, funnelId, name }
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
    renderTopbar();
    closeDrawer();
    await ensureFilterData("stage");
    if (activeFilter?.key !== key) return; // usuário trocou de filtro no meio
    const funnel = funnels.find((f) => f.id === funnelId);
    if (!funnel) return;
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
    const waIds = (funnel.cards || [])
      .filter((c) => c.stage_id === stageId && c.wa_id)
      .map((c) => c.wa_id);
    void applyNativeChatList("custom", waIds);

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

  function openStageMenu(anchor, funnelId, stageId) {
    const funnel = funnels.find((f) => f.id === funnelId);
    const stage = funnel?.stages?.find((s) => s.id === stageId);
    if (!funnel || !stage) return;
    openMenu(anchor, [
      {
        label: "Adicionar / remover contatos",
        onClick: () => openPainel("funis", `&funnel=${encodeURIComponent(funnel.id)}`),
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

  async function createTab() {
    const name = await crmPrompt({ title: "Nova etapa", value: "" });
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
        pairHint || "Zetta CRM · conectando ao seu WhatsApp…",
      )}</span>`;
      return;
    }

    const filter = `<button class="crm-filter">${FILTER_SVG}${escapeHtml(currentFilterLabel())}</button>`;

    if (topbarFilter === "labels") {
      const pills = (waData.labels || [])
        .map((l) => {
          const id = l.id || l.wa_label_id;
          const on = activeFilter?.key === `label:${id}`;
          const labelColor = l.color || "";
          // Quando ativa, aplica a cor da etiqueta no background (inline override)
          const activeStyle = on && labelColor
            ? `background-color:${escapeHtml(labelColor)};border-color:${escapeHtml(labelColor)};box-shadow:0 0 0 3px ${escapeHtml(labelColor)}22;`
            : "";
          const countStyle = l.color
            ? ` style="background-color:${escapeHtml(l.color)};color:#fff"`
            : "";
          return `<button class="crm-pill${on ? " crm-pill-on" : ""}" data-label-id="${escapeHtml(id)}" data-name="${escapeHtml(l.name)}"${activeStyle ? ` style="${activeStyle}"` : ""}>
              ${escapeHtml(l.name)}
              <span class="crm-pill-count"${countStyle}>${Number(l.count ?? l.conversation_count ?? 0)}</span>
            </button>`;
        })
        .join("");
      topbarRef.innerHTML = `${filter}<span class="crm-topbar-divider"></span>${
        pills ||
        `<span class="crm-topbar-hint">${
          syncing ? "sincronizando listas…" : "Nenhuma lista sincronizada ainda."
        }</span>`
      }${premiumPill()}`;
      return;
    }

    const f = currentFunnel();
    const pills = ((f?.stages) || [])
      .map((s) => {
        const cards = (f.cards || []).filter((c) => c.stage_id === s.id);
        const on = activeFilter?.key === `stage:${s.id}`;
        return `<span class="crm-pill${on ? " crm-pill-on" : ""}" data-funnel="${escapeHtml(f.id)}" data-stage="${escapeHtml(s.id)}">
            ${escapeHtml(s.name)}
            <span class="crm-pill-count">${cards.length}</span>
            <button class="crm-pill-gear" data-funnel="${escapeHtml(f.id)}" data-stage="${escapeHtml(s.id)}" title="Opções">${GEAR_SVG}</button>
          </span>`;
      })
      .join("");

    topbarRef.innerHTML = `${filter}<span class="crm-topbar-divider"></span>${
      pills || `<span class="crm-topbar-hint">Nenhuma etapa nesse funil ainda.</span>`
    }<span class="crm-topbar-divider"></span><button class="crm-pill-add-icon" title="Adicionar nova etapa"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10.5V19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v1.5"/><path d="M17 13v6M14 16h6"/></svg></button>${premiumPill()}`;
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
        pairHint = "Zetta CRM · aguardando o WhatsApp Web terminar de carregar…";
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
      pairHint = `Zetta CRM · não consegui vincular: ${res?.error || "sem resposta do servidor"} — tentando de novo…`;
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
    if (document.visibilityState === "visible") ensureChatButton();
  }, 400);
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

  function activeChatFromDom() {
    const header = document.querySelector("#main header");
    if (!header) return null;

    // Filtra textos que são da própria interface do WhatsApp (botões do
    // cabeçalho como "Dados do contato", "Pesquisar" etc.) — sem isso, às
    // vezes um desses textos era lido como se fosse o nome do contato.
    const CHROME_STRINGS = /^(menu|pesquisar|buscar|dados do contato|informações do contato|informações do grupo|chamada de voz|chamada de vídeo|mais opções|anexar|emoji|figurinhas|status)$/i;
    const candidates = Array.from(
      header.querySelectorAll('[title], span[dir="auto"], h1, h2'),
    )
      .map((node) => String(node.getAttribute?.("title") || node.textContent || "").trim())
      .filter((value) => value && value.length <= 160 && !CHROME_STRINGS.test(value));
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
    // Ler o cabeçalho é instantâneo e não carrega o wa-js. O motor interno só
    // é necessário para sincronizar e enviar mensagens; injetá-lo ao clicar no
    // funil era a origem do atraso e dos erros de módulos vistos no console.
    const dom = activeChatFromDom();
    if (dom && (dom.wa_id || dom.phone)) return dom;

    // Fallback determinístico: conversa nova/sem mensagens carregadas, ou o
    // WhatsApp mudou o data-id das linhas — aí o DOM não devolve o wa_id e o
    // envio falhava com "Contato sem telefone". A ponte lê o ID direto do
    // ChatStore, que é a fonte de verdade.
    const fromBridge = await askBridge("active_chat_v290", "active_chat_done_v290", {}, 8000);
    if (fromBridge && (fromBridge.wa_id || fromBridge.phone)) {
      const cached = fromBridge.wa_id ? (waData.contacts || []).find((c) => c.wa_id === fromBridge.wa_id) : null;
      return {
        wa_id: fromBridge.wa_id || null,
        contact_db_id: cached?.id || null,
        phone: fromBridge.phone || cached?.phone || null,
        name: cached?.name || fromBridge.name || dom?.name || "Contato",
        is_group: !!fromBridge.is_group,
      };
    }
    return dom;
  }


  function crmToast(text, kind = "ok") {
    const el = document.createElement("div");
    el.className = `crm-toast${kind === "err" ? " crm-toast-err" : ""}`;
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  const CHAT_BTN_ID = "crm-chat-action";
  const QR_BTN_ID = "crm-chat-quickreply";
  const BOLT_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg>`;


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
    const hasQr = document.getElementById(QR_BTN_ID);
    if (hasCrm && hasQr && header.contains(hasCrm) && header.contains(hasQr)) {
      updateFunnelBadge();
      return;
    }
    hasCrm?.remove();
    hasQr?.remove();

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
      openFunnelModal(btn);
    });

    const qr = document.createElement("button");
    qr.id = QR_BTN_ID;
    qr.className = "crm-chat-btn crm-chat-btn-icon";
    qr.type = "button";
    qr.setAttribute("data-label", "Respostas rápidas");
    qr.innerHTML = BOLT_SVG;
    // Aquece o motor antes do clique: era daí que vinha o atraso do 1º envio.
    qr.addEventListener("mouseenter", prewarmEngine);
    qr.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openQuickReplyModal();
    });

    const slot = headerActionsSlot(header);
    if (slot === header) {
      header.appendChild(btn);
      header.appendChild(qr);
    } else {
      slot.insertAdjacentElement("beforebegin", btn);
      btn.insertAdjacentElement("afterend", qr);
    }
    updateFunnelBadge();
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

  /** true se a conversa aberta agora tem card no Funil principal. */
  function activeChatInMainFunnel() {
    const waId = activeChatIdFromDom();
    if (!waId) return false;
    const funnel = tabFunnel();
    if (!funnel) return false;
    return (funnel.cards || []).some((c) => c.wa_id === waId);
  }

  /** Bolinha no ícone do funil — indica de cara que o lead já está no
   * Funil principal, sem precisar abrir nada. */
  function updateFunnelBadge() {
    const btn = document.getElementById(CHAT_BTN_ID);
    if (!btn) return;
    btn.classList.toggle("crm-chat-btn-active", activeChatInMainFunnel());
  }

  // ---------------------------------------------------------------------
  // Popover leve do funil — ancorado no ícone, sem escurecer/desfocar o
  // fundo (não é mais um modal de tela cheia). Lista as etapas do Funil
  // principal; clicar na bolinha adiciona (se vazia) ou remove (se cheia).
  // ---------------------------------------------------------------------
  function openFunnelModal(anchor) {
    document.querySelector(".crm-fn-pop")?.remove();
    const funnel = tabFunnel();
    const pop = document.createElement("div");
    pop.className = "crm-fn-pop";
    const rect = anchor.getBoundingClientRect();
    pop.style.top = `${rect.bottom + 8}px`;
    pop.style.left = `${Math.min(Math.max(8, rect.left), window.innerWidth - 268)}px`;

    const renderRows = (chat) => {
      if (!funnel) {
        pop.innerHTML = `<p class="crm-fn-pop-title">Funil principal</p><p class="crm-fn-pop-empty">Funil principal ainda não foi criado.</p>`;
        return;
      }
      const stages = funnel.stages || [];
      if (!stages.length) {
        pop.innerHTML = `<p class="crm-fn-pop-title">Funil principal</p><p class="crm-fn-pop-empty">Ainda não tem etapas.</p>`;
        return;
      }
      const memberships = chat ? membershipsFor(chat) : [];
      const inFunnel = memberships.find((m) => m.funnel.id === funnel.id);
      pop.innerHTML = `
        <p class="crm-fn-pop-title">Funil principal</p>
        ${stages
          .map((st) => {
            const isOn = inFunnel?.stage?.id === st.id;
            return `<button class="crm-fn-pop-row" data-stage="${escapeHtml(st.id)}">
              <span class="crm-fn-pop-dot${isOn ? " is-on" : ""}"></span>
              <span class="crm-fn-pop-name">${escapeHtml(st.name)}</span>
            </button>`;
          })
          .join("")}
      `;
    };

    document.body.appendChild(pop);
    let chat = null;
    renderRows(null);
    activeChat().then((c) => { chat = c; renderRows(chat); });
    void loadFunnels().then(() => renderRows(chat));

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
      const dot = row.querySelector(".crm-fn-pop-dot");
      const wasOn = dot.classList.contains("is-on");
      const stageId = row.getAttribute("data-stage");
      const stage = funnel && (funnel.stages || []).find((s) => s.id === stageId);
      if (!funnel || !stage) return;
      row.disabled = true;
      if (!chat) chat = await activeChat();
      if (!chat) {
        crmToast("Não consegui ler a conversa aberta.", "err");
        row.disabled = false;
        return;
      }
      if (wasOn) {
        // Já estava aqui → remove.
        const memberships = membershipsFor(chat);
        const card = memberships.find((m) => m.funnel.id === funnel.id)?.card;
        if (!card) { row.disabled = false; return; }
        const r = await chrome.runtime
          .sendMessage({ type: "api", path: "/api/public/extension/funnel-cards", opts: { method: "DELETE", body: JSON.stringify({ id: card.id }) } })
          .catch(() => null);
        if (r?.ok) {
          crmToast("Removido do funil");
          await loadFunnels();
          updateFunnelBadge();
          renderRows(chat);
        } else {
          crmToast(r?.error || "Não consegui remover.", "err");
          row.disabled = false;
        }
        return;
      }
      // Não estava aqui → adiciona/move (o servidor já remove de qualquer
      // outra etapa/funil automaticamente).
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
        crmToast(`Adicionado em ${stage.name}`);
        await loadFunnels();
        updateFunnelBadge();
        renderRows(chat);
      } else {
        crmToast(r?.error || "Não consegui adicionar ao funil.", "err");
        row.disabled = false;
      }
    });
  }

  // ---------------------------------------------------------------------
  // Pop-up de Respostas Rápidas — só selecionar e disparar.
  // A criação/edição continua no painel do CRM.
  // ---------------------------------------------------------------------
  function openQuickReplyModal() {
    prewarmEngine();
    document.querySelector(".crm-qr-overlay")?.remove();
    const overlay = document.createElement("div");
    overlay.className = "crm-modal-overlay crm-qr-overlay";
    overlay.innerHTML = `
      <div class="crm-qr" role="dialog" aria-modal="true">
        <div class="crm-qr-head">
          <div class="crm-qr-mark">${BOLT_SVG}</div>
          <p class="crm-qr-title">Respostas rápidas</p>
          <button class="crm-qr-close" title="Fechar">&times;</button>
        </div>
        <div class="crm-qr-list"></div>
      </div>
    `;
    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    overlay.querySelector(".crm-qr-close").addEventListener("click", close);
    document.body.appendChild(overlay);

    const render = () => {
      const list = overlay.querySelector(".crm-qr-list");
      if (!list) return;
      if (!quickReplies.length) {
        list.innerHTML = `<p class="crm-qr-empty">Nenhuma resposta rápida cadastrada ainda.</p>`;
        return;
      }
      list.innerHTML = quickReplies
        .map(
          (q, i) => `<div class="crm-qr-item">
            <p class="crm-qr-name">${escapeHtml(q.title)}</p>
            <button class="crm-qr-send" data-send="${i}">Disparar</button>
          </div>`,
        )
        .join("");
    };

    // Abre na hora com o cache; a lista só é recarregada em segundo plano.
    render();
    void loadQuickReplies().then(render);

    overlay.querySelector(".crm-qr-list").addEventListener("click", async (e) => {
      const send = e.target.closest("[data-send]");
      if (!send || quickReplySending) return;
      const reply = quickReplies[Number(send.getAttribute("data-send"))];
      if (!reply) return;
      quickReplySending = true;
      send.disabled = true;
      close();
      const chat = await activeChat();
      if (!chat) {
        quickReplySending = false;
        return;
      }
      try {
        await sendQuickReply(reply, chat);
      } finally {
        quickReplySending = false;
      }
    });
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
    if (!sendable.length) return;
    const prefetched = await chrome.runtime
      .sendMessage({ type: "prefetch_media", actions: sendable })
      .catch(() => null);
    const res = await handleWaAction({
      phone: target,
      waId,
      name: chat.name || "",
      actions: prefetched?.ok ? prefetched.actions : sendable,
    });
    // Sem confirmação de envio: só avisa quando falha.
    if (!res?.ok) crmToast(res?.error || "Falha ao enviar", "err");
  }


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
    const vars = { nome: action?.name || "" };
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