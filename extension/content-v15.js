// Content script v0.18.0 — ponte minimalista: CRM BARBER, Assinantes e Equipe.

(function () {
  const CRM_VERSION = "0.18.0";
  const EXTENSION_BRIDGE_TOKEN = "__extension_bridge__";
  const BODY_DOCKED_CLASS = "crm-assinaturas-docked";
  const BODY_COLLAPSED_CLASS = "crm-assinaturas-docked-collapsed";
  if (window.__crmAssinaturasInjectedVersion === CRM_VERSION) return;
  window.__crmAssinaturasInjectedVersion = CRM_VERSION;
  document.getElementById("crm-assinaturas-panel")?.remove();
  document.body?.classList.remove(BODY_DOCKED_CLASS, BODY_COLLAPSED_CLASS);
  console.info(`[CRM ct v${CRM_VERSION}] carregado`, location.href);

  let panelRef = null;
  let pollHeartbeat = null;

  function readLoggedPhone() {
    try {
      const raw = localStorage.getItem("last-wid-md") || localStorage.getItem("last-wid") || "";
      const m = raw.match(/(\d{8,15})/);
      return m ? m[1] : null;
    } catch { return null; }
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

    const apiBase = r.api_base || "";
    const painelUrl = (section) =>
      `${apiBase}/painel?token=${encodeURIComponent(EXTENSION_BRIDGE_TOKEN)}${section ? `&section=${section}` : ""}`;

    const iconUsers = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
    const iconTrophy = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v3a3 3 0 0 1-3 3"/><path d="M7 5H4v3a3 3 0 0 0 3 3"/></svg>`;
    const chev = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`;

    body().innerHTML = `
      <div class="crm-tiles">
        <button class="crm-tile" data-section="assinantes">
          <span class="crm-tile-icon">${iconUsers}</span>
          <span class="crm-tile-title">Assinantes</span>
          <span class="crm-tile-arrow">${chev}</span>
        </button>
        <button class="crm-tile" data-section="equipe">
          <span class="crm-tile-icon">${iconTrophy}</span>
          <span class="crm-tile-title">Equipe</span>
          <span class="crm-tile-arrow">${chev}</span>
        </button>
      </div>

      ${r.last_error ? `<div class="crm-status-error">${escapeHtml(r.last_error)}</div>` : ""}

      <div class="crm-footer">
        <button class="crm-unpair">desvincular</button>
      </div>
    `;

    body().querySelectorAll(".crm-tile").forEach((el) => {
      el.addEventListener("click", () => {
        window.open(painelUrl(el.getAttribute("data-section")), "_blank", "noopener");
      });
    });

    body().querySelector(".crm-unpair").addEventListener("click", async () => {
      if (!confirm("Desvincular esta conta?")) return;
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
    if (msg?.type === "click_send_v180" || msg?.type === "click_send_v170") {
      clickSendOnOpenChat(msg.job)
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
      return true;
    }
    if (msg?.type === "show_panel") { ensurePanel(); sendResponse({ ok: true }); return true; }
    return false;
  });

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
    if (!d || (d.__crm !== "sent_v180" && d.__crm !== "sent_v170")) return;
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    clearTimeout(p.timeout);
    p.resolve({ ok: !!d.ok, error: d.error });
  });
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizePhone(phone) {
    const only = String(phone || "").replace(/\D/g, "");
    return only.startsWith("55") ? only : `55${only}`;
  }

  async function waitForSelector(selector, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(250);
    }
    return null;
  }

  function findMessageBox() {
    const boxes = [...document.querySelectorAll('div[contenteditable="true"][role="textbox"], div[contenteditable="true"][data-tab]')];
    return boxes.find((el) => {
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      const text = (el.textContent || "").trim();
      return aria.includes("mensagem") || aria.includes("message") || text.length >= 0;
    }) || null;
  }

  function findSendButton() {
    return document.querySelector('button[aria-label="Enviar"], button[aria-label="Send"]')
      || document.querySelector('span[data-icon="send"]')?.closest('button, [role="button"]')
      || document.querySelector('[data-testid="send"]')?.closest('button, [role="button"]');
  }

  async function clickSendOnOpenChat(job) {
    try {
      const text = job?.body;
      if (!text) return { ok: false, error: "Job inválido" };
      const box = await waitForSelector('div[contenteditable="true"]', 45000);
      if (!box) return { ok: false, error: "Campo de mensagem não apareceu no WhatsApp" };
      await sleep(2200);
      const sendButton = findSendButton();
      if (!sendButton) {
        const messageBox = findMessageBox() || box;
        messageBox.focus();
        document.execCommand("insertText", false, text);
        await sleep(500);
      }
      const btn = findSendButton();
      if (!btn) return { ok: false, error: "Botão enviar não apareceu no WhatsApp" };
      btn.click();
      await sleep(1400);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  async function handleSend(job) {
    const phone = job?.customer?.phone;
    const text = job?.body;
    if (!phone || !text) return { ok: false, error: "Job inválido" };
    const id = crypto.randomUUID();
    const silent = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, error: "Timeout no envio silencioso" });
      }, 25000);
      pending.set(id, { resolve, timeout });
      window.postMessage({ __crm: "send_v180", id, phone, text }, "*");
    });
    if (silent?.ok) return silent;
    return { ok: false, error: silent?.error || "Envio silencioso falhou" };
  }
})();