// Content script v0.25.0 — abas do CRM no topo do WhatsApp Web + trilho de
// ícones minimalista à esquerda. Clicar numa aba/lista filtra a própria
// lista de conversas do WhatsApp (não abre o CRM).

(function () {
  const CRM_VERSION = "0.33.2";
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

  let pollHeartbeat = null;
  let railRef = null;
  let topbarRef = null;
  let status = { paired: false };
  let funnels = [];
  let billing = null;
  let waData = { labels: [], contacts: [] };
  let quickReplies = [];
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
  }


  async function loadFunnels() {
    const r = await chrome.runtime
      .sendMessage({ type: "api", path: "/api/public/extension/funnels" })
      .catch(() => null);
    if (r?.ok) {
      funnels = r.funnels || [];
      renderTopbar();
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
    users: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></svg>`,
    funnel: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h18l-7 8v7l-4 2v-9L3 4z"/></svg>`,
    trophy: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/></svg>`,
    phone: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.4 2.1L8.1 9.6a16 16 0 0 0 6.3 6.3l1.2-1.2a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.6A2 2 0 0 1 22 16.9z"/></svg>`,
    sync: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>`,
    gear: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7"/></svg>`,
    exit: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>`,
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
      <div class="crm-rail-mark">CB</div>
      <button class="crm-rail-btn" data-go="assinantes" data-label="Gestão de Assinaturas">${ICONS.users}</button>
      <button class="crm-rail-btn" data-go="funis" data-label="Funis de Vendas">${ICONS.funnel}</button>
      <button class="crm-rail-btn" data-go="equipe" data-label="Equipe">${ICONS.trophy}</button>
      <button class="crm-rail-btn" data-go="conexao" data-label="Conexão">${ICONS.phone}</button>
      <button class="crm-rail-btn" data-act="sync" data-label="Sincronizar listas e conversas">${ICONS.sync}</button>
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

      const addBtn = e.target.closest(".crm-pill-add");
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
    const f = currentFunnel();
    return (f?.name || "FUNIL PRINCIPAL").toUpperCase();
  }

  /** Funil selecionado no topo (qualquer funil, não só o "tab"). */
  function currentFunnel() {
    if (topbarFilter.startsWith("funnel:")) {
      const id = topbarFilter.slice(7);
      const found = funnels.find((f) => f.id === id);
      if (found) return found;
    }
    return tabFunnel() || funnels.find((f) => f.mode !== "label") || null;
  }

  function openFilterMenu(anchor) {
    // "LISTAS" aqui vem direto das etiquetas do WhatsApp. O funil espelho
    // (mode "label") fica de fora para não duplicar a opção no menu.
    const items = [{ label: "LISTAS", onClick: () => setTopbarFilter("labels") }];
    for (const f of funnels) {
      if (f.mode === "label") continue;
      items.push({ label: f.name.toUpperCase(), onClick: () => setTopbarFilter(`funnel:${f.id}`) });
    }
    openMenu(anchor, items);
  }

  // ---------------------------------------------------------------------
  // Filtro da própria lista de conversas do WhatsApp (não abre o CRM).
  // ---------------------------------------------------------------------
  let activeFilter = null; // { key, terms: string[] }
  let filterObserver = null;

  function chatRows() {
    const pane = document.querySelector("#pane-side");
    return pane ? Array.from(pane.querySelectorAll('[role="listitem"]')) : [];
  }

  function rowText(row) {
    const t = row.querySelector("span[title]");
    return String(t?.getAttribute("title") || row.innerText || "").toLowerCase();
  }

  function applyChatFilter() {
    if (!activeFilter) return;
    for (const row of chatRows()) {
      const text = rowText(row);
      const digits = text.replace(/\D/g, "");
      const match = activeFilter.terms.some((t) =>
        /^\d{8,}$/.test(t) ? digits.includes(t.slice(-8)) : text.includes(t),
      );
      row.style.display = match ? "" : "none";
    }
  }


  function clearChatFilter() {
    for (const row of chatRows()) row.style.display = "";
    filterObserver?.disconnect();
    filterObserver = null;
    activeFilter = null;
    renderTopbar();
  }

  function setChatFilter(key, terms) {
    if (activeFilter?.key === key) return clearChatFilter();
    const clean = terms.map((t) => String(t || "").trim().toLowerCase()).filter(Boolean);
    activeFilter = { key, terms: clean };
    const pane = document.querySelector("#pane-side");
    filterObserver?.disconnect();
    filterObserver = new MutationObserver(() => applyChatFilter());
    if (pane) filterObserver.observe(pane, { childList: true, subtree: true });
    applyChatFilter();
    renderTopbar();
  }

  /** Lista: filtra a lista de conversas pelos contatos daquela lista. */
  async function filterByLabel(labelId, _labelName) {
    const terms = [];
    for (const c of waData.contacts || []) {
      if (!(c.label_ids || []).includes(labelId)) continue;
      if (c.name) terms.push(c.name);
      if (c.phone) terms.push(c.phone);
      if (!c.name && !c.phone && c.wa_id) terms.push(String(c.wa_id).split("@")[0]);
    }
    setChatFilter(`label:${labelId}`, terms);
  }

  /** Aba/etapa do funil principal: filtra a lista pelos leads daquela etapa. */
  function filterByStage(funnelId, stageId) {
    const funnel = funnels.find((f) => f.id === funnelId);
    if (!funnel) return;
    const terms = [];
    for (const c of funnel.cards || []) {
      if (c.stage_id !== stageId) continue;
      if (c.title) terms.push(c.title);
      if (c.phone) terms.push(c.phone);
    }
    setChatFilter(`stage:${stageId}`, terms);
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
        pairHint || "CRM Barber · conectando ao seu WhatsApp…",
      )}</span>`;
      return;
    }

    const filter = `<button class="crm-filter">${FILTER_SVG}${escapeHtml(currentFilterLabel())}</button>`;

    if (topbarFilter === "labels") {
      const pills = (waData.labels || [])
        .map((l) => {
          const id = l.id || l.wa_label_id;
          const on = activeFilter?.key === `label:${id}`;
          return `<button class="crm-pill${on ? " crm-pill-on" : ""}" data-label-id="${escapeHtml(id)}" data-name="${escapeHtml(l.name)}">
              ${escapeHtml(l.name)}
              <span class="crm-pill-count">${Number(l.count ?? l.conversation_count ?? 0)}</span>
            </button>`;
        })
        .join("");
      topbarRef.innerHTML = `${filter}${
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

    topbarRef.innerHTML = `${filter}${
      pills || `<span class="crm-topbar-hint">Nenhuma etapa nesse funil ainda.</span>`
    }<button class="crm-pill crm-pill-add">+ etapa</button>${premiumPill()}`;
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
        pairHint = "CRM Barber · aguardando o WhatsApp Web terminar de carregar…";
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
      pairHint = `CRM Barber · não consegui vincular: ${res?.error || "sem resposta do servidor"} — tentando de novo…`;
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
  setInterval(maintenanceTick, 3000);
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

  function activeChatFromDom() {
    const header = document.querySelector("#main header");
    if (!header) return null;

    const candidates = Array.from(
      header.querySelectorAll('[title], span[dir="auto"], h1, h2'),
    )
      .map((node) => String(node.getAttribute?.("title") || node.textContent || "").trim())
      .filter((value) => value && value.length <= 160 && !/^(menu|pesquisar|buscar)$/i.test(value));
    const name = candidates[0] || "Contato";
    const digits = String(header.textContent || "").replace(/\D/g, "");
    const visiblePhone = digits.length >= 10 && digits.length <= 13 ? digits : null;

    const normalizedName = name.toLocaleLowerCase("pt-BR");
    const matches = (waData.contacts || []).filter(
      (contact) => String(contact.name || "").trim().toLocaleLowerCase("pt-BR") === normalizedName,
    );
    const cached = matches.length === 1 ? matches[0] : null;
    return {
      wa_id: cached?.wa_id || null,
      phone: visiblePhone || cached?.phone || null,
      name: cached?.name || name,
      is_group: cached?.is_group || false,
    };
  }

  async function activeChat() {
    // Ler o cabeçalho é instantâneo e não carrega o wa-js. O motor interno só
    // é necessário para sincronizar e enviar mensagens; injetá-lo ao clicar no
    // funil era a origem do atraso e dos erros de módulos vistos no console.
    return activeChatFromDom();
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
    if (hasCrm && hasQr && header.contains(hasCrm) && header.contains(hasQr)) return;
    hasCrm?.remove();
    hasQr?.remove();

    const btn = document.createElement("button");
    btn.id = CHAT_BTN_ID;
    btn.type = "button";
    btn.title = "Adicionar este contato a um funil";
    btn.className = "crm-chat-btn crm-chat-btn-icon";
    btn.innerHTML = ICONS.funnel;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openChatActionMenu(btn);
    });

    const qr = document.createElement("button");
    qr.id = QR_BTN_ID;
    qr.className = "crm-chat-btn crm-chat-btn-icon";
    qr.type = "button";
    qr.title = "Respostas rápidas";
    qr.innerHTML = BOLT_SVG;
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
  }


  /** Botão CRM: somente funis (listas ficam com a função nativa do WhatsApp). */
  function openChatActionMenu(anchor) {
    if (!funnels.length) {
      void loadFunnels().then(() => openChatActionMenu(anchor));
      return;
    }
    openMenu(
      anchor,
      funnels.filter((f) => f.mode !== "label").map((f) => ({ label: f.name, onClick: () => chooseStage(anchor, f) })),
    );
  }

  function chooseStage(anchor, funnel) {
    const stages = funnel.stages || [];
    if (!stages.length) return crmToast(`"${funnel.name}" ainda não tem etapas.`, "err");
    openMenu(
      anchor,
      stages.map((st) => ({
        label: st.name,
        onClick: async () => {
          const chat = await activeChat();
          if (!chat) return crmToast("Não consegui ler a conversa aberta.", "err");
          const r = await chrome.runtime
            .sendMessage({
              type: "api",
              path: "/api/public/extension/funnel-cards",
              opts: {
                method: "POST",
                body: JSON.stringify({
                  funnel_id: funnel.id,
                  stage_id: st.id,
                  title: chat.name || chat.phone || "Contato",
                  phone: chat.phone || null,
                  wa_contact_id: chat.wa_id || null,
                }),
              },
            })
            .catch(() => null);
          if (r?.ok) {
            crmToast(`Adicionado em ${funnel.name} · ${st.name}`);
            loadFunnels();
          } else {
            crmToast(r?.error || "Não consegui adicionar ao funil.", "err");
          }
        },
      })),
    );
  }

  // ---------------------------------------------------------------------
  // Pop-up de Respostas Rápidas — só selecionar e disparar.
  // A criação/edição continua no painel do CRM.
  // ---------------------------------------------------------------------
  function openQuickReplyModal() {
    document.querySelector(".crm-qr-overlay")?.remove();
    const overlay = document.createElement("div");
    overlay.className = "crm-modal-overlay crm-qr-overlay";
    overlay.innerHTML = `
      <div class="crm-qr" role="dialog" aria-modal="true">
        <div class="crm-qr-head">
          <p class="crm-qr-title">Respostas rápidas</p>
          <button class="crm-qr-close" title="Fechar">✕</button>
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
      if (!send) return;
      const reply = quickReplies[Number(send.getAttribute("data-send"))];
      close();
      const chat = await activeChat();
      if (!chat) return;
      void sendQuickReply(reply, chat);
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
          <input class="crm-modal-input" value="${escapeHtml(value)}" style="width:100%;margin-bottom:16px;padding:9px 10px;border-radius:8px;border:1px solid #2a2a2a;background:#1a1a1a;color:#f5f5f5;font-size:13px;outline:none" />
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
    if (!d || (d.__crm !== "sent_v180" && d.__crm !== "sent_v170" && d.__crm !== "action_done_v190")) return;
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
      __crm: "action_v190",
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
      : await bridgeRequest({ __crm: "send_v180", phone, text });

    if (silent?.ok) return silent;
    return { ok: false, error: silent?.error || "Envio silencioso falhou" };
  }
})();