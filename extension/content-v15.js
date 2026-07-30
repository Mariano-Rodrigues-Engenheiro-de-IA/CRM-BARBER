// Content script v0.20.0 — ponte minimalista: CRM BARBER, Assinantes, Equipe e Conexão.

(function () {
  const CRM_VERSION = "0.20.0";
  const EXTENSION_BRIDGE_TOKEN = "__extension_bridge__";
  const BODY_DOCKED_CLASS = "crm-assinaturas-docked";
  const BODY_COLLAPSED_CLASS = "crm-assinaturas-docked-collapsed";
  if (window.__crmAssinaturasInjectedVersion === CRM_VERSION) return;
  window.__crmAssinaturasInjectedVersion = CRM_VERSION;
  document.getElementById("crm-assinaturas-panel")?.remove();
  document.body?.classList.remove(BODY_DOCKED_CLASS, BODY_COLLAPSED_CLASS);
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


  let panelRef = null;
  let pollHeartbeat = null;

  function readLoggedPhone() {
    try {
      const raw = localStorage.getItem("last-wid-md") || localStorage.getItem("last-wid") || "";
      const m = raw.match(/(\d{8,15})/);
      return m ? m[1] : null;
    } catch { return null; }
  }

  let activeTab = "atalhos";
  let waData = { labels: [], contacts: [] };
  let syncTimer = null;
  let syncing = false;

  /** Pede etiquetas/conversas ao bridge (MAIN world) via postMessage. */
  function askBridgeCollect() {
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      const timeout = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        resolve(null);
      }, 20000);
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

  /** Coleta local + envio para o CRM. Silencioso: nunca quebra o painel. */
  async function syncWaData(rerender) {
    if (syncing) return;
    syncing = true;
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
      if (rerender && activeTab === "etiquetas") render();
    } finally {
      syncing = false;
    }
  }

  function startSync() {
    if (syncTimer) return;
    syncWaData(true);
    syncTimer = setInterval(() => syncWaData(true), 10 * 60 * 1000);
  }

  function buildPanel() {
    const panel = document.createElement("div");
    panel.id = "crm-assinaturas-panel";
    panel.className = "crm-theme-barber";
    panel.innerHTML = `
      <div class="crm-header">
        <span class="crm-header-tag">CRM BARBER</span>
        <button class="crm-toggle" title="Recolher">‹</button>
      </div>
      <div class="crm-body"></div>
    `;
    document.body.appendChild(panel);
    document.body.classList.add(BODY_DOCKED_CLASS);
    panelRef = panel;

    panel.querySelector(".crm-toggle").addEventListener("click", () => {
      const c = panel.classList.toggle("crm-collapsed");
      document.body.classList.toggle(BODY_COLLAPSED_CLASS, c);
      panel.querySelector(".crm-toggle").textContent = c ? "›" : "‹";
    });

    render();
    return panel;
  }

  function body() { return panelRef.querySelector(".crm-body"); }

  async function render() {
    const r = await chrome.runtime.sendMessage({ type: "get_status" });
    const paired = !!r?.paired;

    if (!paired) {
      stopPollHeartbeat();
      const phone = readLoggedPhone();
      if (phone) {
        chrome.runtime.sendMessage({ type: "pair", phone }).then((res) => {
          if (res?.ok) render();
        });
      }
      body().innerHTML = `
        <div class="crm-empty-state">
          <div class="crm-empty-dot"></div>
          <p class="crm-empty-title">Conectando…</p>
          <p class="crm-empty-sub">Vinculando ao seu WhatsApp. Se demorar, atualize a página.</p>
        </div>
      `;
      return;
    }

    startPollHeartbeat();
    startSync();

    const apiBase = r.api_base || "";
    const panelToken = r.token || EXTENSION_BRIDGE_TOKEN;
    const painelUrl = (section) =>
      `${apiBase}/painel?token=${encodeURIComponent(panelToken)}${section ? `&section=${section}` : ""}`;

    const iconUsers = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
    const iconTrophy = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v3a3 3 0 0 1-3 3"/><path d="M7 5H4v3a3 3 0 0 0 3 3"/></svg>`;
    const iconPhone = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.77.62 2.61a2 2 0 0 1-.45 2.11L8.09 9.63a16 16 0 0 0 6.28 6.28l1.19-1.19a2 2 0 0 1 2.11-.45c.84.29 1.71.5 2.61.62A2 2 0 0 1 22 16.92z"/></svg>`;
    const iconFunnel = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h18l-7 8v7l-4 2v-9L3 4z"/></svg>`;
    const chev = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`;

    const tabsHtml = `
      <div class="crm-tabs">
        <button class="crm-tab ${activeTab === "atalhos" ? "is-active" : ""}" data-tab="atalhos">Atalhos</button>
        <button class="crm-tab ${activeTab === "etiquetas" ? "is-active" : ""}" data-tab="etiquetas">Etiquetas</button>
      </div>
    `;

    if (activeTab === "etiquetas") {
      const labels = waData.labels || [];
      const rows = labels.length
        ? labels
            .map(
              (l) => `
              <button class="crm-label-row" data-label="${escapeHtml(String(l.id))}">
                <span class="crm-label-dot" style="background:${escapeHtml(l.color || "#f5c518")}"></span>
                <span class="crm-label-name">${escapeHtml(l.name)}</span>
                <span class="crm-label-count">${
                  (waData.contacts || []).filter((c) => (c.label_ids || []).includes(String(l.id))).length
                }</span>
              </button>`,
            )
            .join("")
        : `<p class="crm-empty-sub">${syncing ? "Sincronizando…" : "Nenhuma etiqueta encontrada no WhatsApp."}</p>`;

      body().innerHTML = `
        ${tabsHtml}
        <div class="crm-labels">${rows}</div>
        <div class="crm-footer">
          <button class="crm-sync">sincronizar agora</button>
        </div>
      `;
      body().querySelectorAll(".crm-tab").forEach((el) =>
        el.addEventListener("click", () => {
          activeTab = el.getAttribute("data-tab");
          render();
        }),
      );
      body().querySelector(".crm-sync").addEventListener("click", () => {
        syncing = false;
        syncWaData(true);
        render();
      });
      body().querySelectorAll(".crm-label-row").forEach((el) =>
        el.addEventListener("click", () => {
          window.open(painelUrl("funis"), "_blank", "noopener");
        }),
      );
      return;
    }

    body().innerHTML = `
      ${tabsHtml}
      <div class="crm-tiles">
        <button class="crm-tile" data-section="assinantes">
          <span class="crm-tile-icon">${iconUsers}</span>
          <span class="crm-tile-title">Gestão de Assinaturas</span>
          <span class="crm-tile-arrow">${chev}</span>
        </button>
        <button class="crm-tile" data-section="funis">
          <span class="crm-tile-icon">${iconFunnel}</span>
          <span class="crm-tile-title">Funis de Vendas</span>
          <span class="crm-tile-arrow">${chev}</span>
        </button>
        <button class="crm-tile" data-section="equipe">
          <span class="crm-tile-icon">${iconTrophy}</span>
          <span class="crm-tile-title">Equipe</span>
          <span class="crm-tile-arrow">${chev}</span>
        </button>
        <button class="crm-tile" data-section="conexao">
          <span class="crm-tile-icon">${iconPhone}</span>
          <span class="crm-tile-title">Conexão</span>
          <span class="crm-tile-arrow">${chev}</span>
        </button>
      </div>

      ${r.last_error ? `<div class="crm-status-error">${escapeHtml(r.last_error)}</div>` : ""}

      <div class="crm-footer">
        <button class="crm-unpair">desvincular</button>
      </div>
    `;

    body().querySelectorAll(".crm-tab").forEach((el) =>
      el.addEventListener("click", () => {
        activeTab = el.getAttribute("data-tab");
        render();
      }),
    );

    body().querySelectorAll(".crm-tile").forEach((el) => {
      el.addEventListener("click", () => {
        window.open(painelUrl(el.getAttribute("data-section")), "_blank", "noopener");
      });
    });

    body().querySelector(".crm-unpair").addEventListener("click", async () => {
      const ok = await crmConfirm({
        title: "Desvincular esta conta?",
        body: "O CRM para de disparar por este WhatsApp até você vincular de novo.",
        confirmLabel: "Desvincular",
      });
      if (!ok) return;
      await chrome.runtime.sendMessage({ type: "unpair" });
      render();
    });
  }

  function ensurePanel() {
    if (!document.getElementById("crm-assinaturas-panel")) buildPanel();
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

  ensurePanel();
  const mo = new MutationObserver(() => ensurePanel());
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
    if (msg?.type === "show_panel") { ensurePanel(); sendResponse({ ok: true }); return true; }
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