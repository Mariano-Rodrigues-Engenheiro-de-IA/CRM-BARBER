// Content script v0.13.0 — sidebar bridge com o mesmo layout do painel:
// header emoldurado + linhas com chevron. Nome da barbearia vem do /meta.

(function () {
  const CRM_VERSION = "0.13.0";
  const BODY_DOCKED_CLASS = "crm-assinaturas-docked";
  const BODY_COLLAPSED_CLASS = "crm-assinaturas-docked-collapsed";
  if (window.__crmAssinaturasInjectedVersion === CRM_VERSION) return;
  window.__crmAssinaturasInjectedVersion = CRM_VERSION;
  document.getElementById("crm-assinaturas-panel")?.remove();
  document.body?.classList.remove(BODY_DOCKED_CLASS, BODY_COLLAPSED_CLASS);
  console.info(`[CRM ct v${CRM_VERSION}] carregado`, location.href);

  let panelRef = null;
  let shopCache = null; // { name }

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

  async function fetchShop(apiBase, token) {
    if (shopCache) return shopCache;
    try {
      const res = await fetch(`${apiBase}/api/public/extension/meta`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data?.ok && data.barbershop) {
        shopCache = { name: data.barbershop.name || "Sua barbearia" };
      }
    } catch { /* ignore */ }
    return shopCache || { name: "Sua barbearia" };
  }

  async function render() {
    const r = await chrome.runtime.sendMessage({ type: "get_status" });
    const paired = !!r?.paired;

    if (!paired) {
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

    const token = r.token || "";
    const apiBase = r.api_base || "";
    const painelUrl = (section) =>
      `${apiBase}/painel?token=${encodeURIComponent(token)}${section ? `&section=${section}` : ""}`;

    const shop = await fetchShop(apiBase, token);
    const initial = (shop.name || "B").trim().charAt(0).toUpperCase();

    body().innerHTML = `
      <div class="crm-brand-card">
        <div class="crm-brand-avatar">${initial}</div>
        <div class="crm-brand-info">
          <div class="crm-brand-tag">CRM BARBER</div>
          <div class="crm-brand-name">${escapeHtml(shop.name)}</div>
        </div>
      </div>

      <div class="crm-divider"></div>

      <div class="crm-tiles">
        <button class="crm-tile" data-section="assinantes">
          <span class="crm-tile-icon">👥</span>
          <span class="crm-tile-title">Assinantes</span>
          <span class="crm-tile-arrow">›</span>
        </button>
        <button class="crm-tile" data-section="equipe">
          <span class="crm-tile-icon">🏆</span>
          <span class="crm-tile-title">Equipe</span>
          <span class="crm-tile-arrow">›</span>
        </button>
      </div>

      <div class="crm-footer">
        <button class="crm-tile crm-tile-ghost" data-section="configuracoes">
          <span class="crm-tile-icon">⚙️</span>
          <span class="crm-tile-title">Configurações</span>
          <span class="crm-tile-arrow">›</span>
        </button>
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
      shopCache = null;
      await chrome.runtime.sendMessage({ type: "unpair" });
      render();
    });
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  function ensurePanel() {
    if (!document.getElementById("crm-assinaturas-panel")) buildPanel();
  }
  ensurePanel();
  const mo = new MutationObserver(() => ensurePanel());
  if (document.body) mo.observe(document.body, { childList: true });

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === "send_message") {
      handleSend(msg.job).then(sendResponse);
      return true;
    }
    if (msg?.type === "show_panel") { ensurePanel(); sendResponse({ ok: true }); return true; }
    return false;
  });

  // Envio silencioso via wa-bridge (MAIN world) — inalterado.
  const pending = new Map();
  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.__crm !== "sent") return;
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    clearTimeout(p.timeout);
    p.resolve({ ok: !!d.ok, error: d.error });
  });
  async function handleSend(job) {
    const phone = job?.customer?.phone;
    const text = job?.body;
    if (!phone || !text) return { ok: false, error: "Job inválido" };
    return await new Promise((resolve) => {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const timeout = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, error: "Bridge silenciosa não respondeu" });
      }, 30000);
      pending.set(id, { resolve, timeout });
      window.postMessage({ __crm: "send_v9", id, phone, text }, "*");
    });
  }
})();
