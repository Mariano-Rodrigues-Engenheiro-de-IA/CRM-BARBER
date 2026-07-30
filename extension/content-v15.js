// Content script v0.21.0 — abas do CRM no topo do WhatsApp Web + trilho de
// ícones minimalista à esquerda (nada de painel ocupando espaço).

(function () {
  const CRM_VERSION = "0.21.0";
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
  ensureWaScriptsInjected().catch(() => null);


  let pollHeartbeat = null;
  let railRef = null;
  let topbarRef = null;
  let status = { paired: false };
  let funnels = [];
  let waData = { labels: [], contacts: [] };
  let syncTimer = null;
  let syncing = false;

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

  function startSync() {
    if (syncTimer) return;
    syncWaData();
    syncTimer = setInterval(() => syncWaData(), 10 * 60 * 1000);
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

  function buildShell() {
    const rail = document.createElement("div");
    rail.id = "crm-rail";
    rail.innerHTML = `
      <div class="crm-rail-mark">CB</div>
      <button class="crm-rail-btn" data-go="assinantes" title="Gestão de Assinaturas">${ICONS.users}</button>
      <button class="crm-rail-btn" data-go="funis" title="Funis de Vendas">${ICONS.funnel}</button>
      <button class="crm-rail-btn" data-go="equipe" title="Equipe">${ICONS.trophy}</button>
      <button class="crm-rail-btn" data-go="conexao" title="Conexão">${ICONS.phone}</button>
      <button class="crm-rail-btn" data-act="sync" title="Sincronizar etiquetas e conversas">${ICONS.sync}</button>
      <div class="crm-rail-spacer"></div>
      <button class="crm-rail-btn" data-go="configuracoes" title="Configurações">${ICONS.gear}</button>
      <button class="crm-rail-btn" data-act="unpair" title="Desvincular">${ICONS.exit}</button>
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
      const pill = e.target.closest(".crm-pill");
      if (!pill) return;
      const id = pill.getAttribute("data-funnel");
      openPainel("funis", id ? `&funnel=${encodeURIComponent(id)}` : "");
    });

    renderTopbar();
  }

  function formatBRL(cents) {
    return ((cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function renderTopbar() {
    if (!topbarRef) return;

    if (!status.paired) {
      topbarRef.innerHTML = `<span class="crm-topbar-hint">CRM Barber · conectando ao seu WhatsApp…</span>`;
      return;
    }

    // Abas = funis (as abas criadas no CRM aparecem aqui em primeiro lugar).
    const ordered = [...funnels].sort((a, b) => (a.mode === "tab" ? -1 : 0) - (b.mode === "tab" ? -1 : 0));
    const pills = ordered
      .map((f) => {
        const total = (f.cards || []).reduce((s, c) => s + (c.value_cents || 0), 0);
        return `<button class="crm-pill" data-funnel="${escapeHtml(f.id)}">
          ${escapeHtml(f.name)}
          <span class="crm-pill-value">${escapeHtml(formatBRL(total))}</span>
        </button>`;
      })
      .join("");

    topbarRef.innerHTML = `
      ${pills || `<span class="crm-topbar-hint">Nenhuma aba criada ainda.</span>`}
      <button class="crm-pill crm-pill-add">+ nova aba</button>
      <span class="crm-topbar-status">${
        syncing
          ? "sincronizando…"
          : `${waData.labels.length} etiquetas · ${waData.contacts.length} conversas`
      }</span>
    `;
  }

  async function refresh() {
    const r = await chrome.runtime.sendMessage({ type: "get_status" }).catch(() => null);
    status = r || { paired: false };

    if (!status.paired) {
      stopPollHeartbeat();
      renderTopbar();
      const phone = readLoggedPhone();
      if (phone) {
        chrome.runtime.sendMessage({ type: "pair", phone }).then((res) => {
          if (res?.ok) refresh();
        });
      }
      return;
    }

    renderTopbar();
    startPollHeartbeat();
    startSync();
    loadFunnels();
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
  setInterval(() => loadFunnels(), 60000);
  const mo = new MutationObserver(() => ensureShell());
  if (document.body) mo.observe(document.body, { childList: true });


  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
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
    if (!phone) return { ok: false, error: "Telefone inválido" };
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
      openOnly: !!action.openOnly,
      actions,
    });
  }

  async function handleSend(job) {
    const phone = job?.customer?.phone;
    const text = job?.body;
    if (!phone || !text) return { ok: false, error: "Job inválido" };
    try {
      await ensureWaScriptsInjected();
    } catch (e) {
      return { ok: false, error: `Falha ao carregar wa-js/bridge: ${String(e?.message || e)}` };
    }
    const silent = await bridgeRequest({ __crm: "send_v180", phone, text });

    if (silent?.ok) return silent;
    return { ok: false, error: silent?.error || "Envio silencioso falhou" };
  }
})();