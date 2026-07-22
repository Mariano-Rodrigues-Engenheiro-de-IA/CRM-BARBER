// Content script v0.10.0 — sidebar reduzida no WhatsApp Web.
// A gestão de assinantes agora vive no painel web em nova aba (/painel).
// Aqui ficam: status de pareamento, botão "Abrir painel", campanhas em
// andamento com pausar/retomar/cancelar.

(function () {
  const CRM_VERSION = "0.10.0";
  const BODY_DOCKED_CLASS = "crm-assinaturas-docked";
  const BODY_COLLAPSED_CLASS = "crm-assinaturas-docked-collapsed";
  if (window.__crmAssinaturasInjectedVersion === CRM_VERSION) return;
  window.__crmAssinaturasInjectedVersion = CRM_VERSION;
  document.getElementById("crm-assinaturas-panel")?.remove();
  document.body?.classList.remove(BODY_DOCKED_CLASS, BODY_COLLAPSED_CLASS);
  console.info(`[CRM ct v${CRM_VERSION}] carregado`, location.href);

  let panelRef = null;
  let pollTimer = null;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  function readLoggedPhone() {
    try {
      const raw = localStorage.getItem("last-wid-md") || localStorage.getItem("last-wid") || "";
      const m = raw.match(/(\d{8,15})/);
      return m ? m[1] : null;
    } catch { return null; }
  }
  async function api(path, opts = {}) {
    return await chrome.runtime.sendMessage({ type: "api", path, opts });
  }

  function buildPanel() {
    const panel = document.createElement("div");
    panel.id = "crm-assinaturas-panel";
    panel.className = "crm-theme-barber";
    panel.innerHTML = `
      <div class="crm-header">
        <span class="crm-logo">✂ Assinaturas</span>
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
      const phone = readLoggedPhone();
      if (phone) {
        chrome.runtime.sendMessage({ type: "pair", phone }).then((res) => {
          if (res?.ok) render();
        });
      }
      body().innerHTML = `
        <div class="crm-status">Vinculando ao seu WhatsApp…</div>
        <p class="crm-hint">Se o pareamento demorar, atualize esta aba.</p>
      `;
      return;
    }

    const info = r.barbershop || {};
    const token = r.token || "";
    const painelUrl = `${r.api_base || ""}/painel?token=${encodeURIComponent(token)}`;

    body().innerHTML = `
      <div class="crm-status">
        <strong>${esc(info.name || "Barbearia")}</strong>
        <small>${esc(info.owner_phone || "")}</small>
      </div>

      <button class="crm-primary crm-open-painel">
        🚀 Abrir painel de assinaturas
      </button>
      <p class="crm-hint">O painel completo (kanban, importação, disparos) roda em nova aba com seu WhatsApp aberto aqui.</p>

      <div class="crm-section-title">Campanhas ativas</div>
      <div class="crm-camps">Carregando…</div>

      <button class="crm-ghost crm-unpair">Desvincular esta conta</button>
    `;

    body().querySelector(".crm-open-painel").addEventListener("click", () => {
      window.open(painelUrl, "_blank", "noopener");
    });
    body().querySelector(".crm-unpair").addEventListener("click", async () => {
      if (!confirm("Desvincular esta conta? A extensão pedirá pareamento novamente.")) return;
      await chrome.runtime.sendMessage({ type: "unpair" });
      render();
    });

    loadCampaigns();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(loadCampaigns, 5000);
  }

  async function loadCampaigns() {
    const box = panelRef?.querySelector(".crm-camps");
    if (!box) return;
    const r = await api("/api/public/extension/campaigns");
    if (!r?.ok) { box.textContent = r?.error || "Erro"; return; }
    const camps = (r.campaigns || []).filter((c) => {
      const s = c.stats || { pending: 0, sent: 0, failed: 0 };
      const total = s.pending + s.sent + s.failed;
      return c.status !== "canceled" && (s.pending > 0 || c.status === "paused" || total === 0);
    }).slice(0, 5);

    if (!camps.length) {
      box.innerHTML = `<p class="crm-empty">Nenhuma campanha em andamento.</p>`;
      return;
    }

    box.innerHTML = camps.map((c) => {
      const s = c.stats || { pending: 0, sent: 0, failed: 0 };
      const total = s.pending + s.sent + s.failed;
      const done = s.sent + s.failed;
      const pct = total ? Math.round((done / total) * 100) : 0;
      const running = c.status === "running";
      return `
        <div class="crm-camp-card" data-id="${esc(c.id)}">
          <div class="crm-camp-name">${esc(c.name)}</div>
          <div class="crm-progress"><div class="crm-progress-bar" style="width:${pct}%"></div></div>
          <div class="crm-progress-info">
            <span>${done}/${total} · ${s.failed} falhas ${running ? "" : "· ⏸"}</span>
            <span>${pct}%</span>
          </div>
          <div class="crm-camp-actions">
            <button class="crm-btn-toggle" data-next="${running ? "paused" : "running"}">
              ${running ? "⏸ Pausar" : "▶ Retomar"}
            </button>
            <button class="crm-btn-cancel">✕ Cancelar</button>
          </div>
        </div>
      `;
    }).join("");

    box.querySelectorAll(".crm-camp-card").forEach((card) => {
      const id = card.getAttribute("data-id");
      card.querySelector(".crm-btn-toggle").addEventListener("click", async (e) => {
        const next = e.currentTarget.getAttribute("data-next");
        await api(`/api/public/extension/campaigns/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: next }),
        });
        loadCampaigns();
      });
      card.querySelector(".crm-btn-cancel").addEventListener("click", async () => {
        if (!confirm("Cancelar esta campanha?")) return;
        await api(`/api/public/extension/campaigns/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "canceled" }),
        });
        loadCampaigns();
      });
    });
  }

  // Injeta ao carregar; retenta se WhatsApp reidratar.
  function ensurePanel() {
    if (!document.getElementById("crm-assinaturas-panel")) buildPanel();
  }
  ensurePanel();
  const mo = new MutationObserver(() => ensurePanel());
  if (document.body) mo.observe(document.body, { childList: true });

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === "send_message") {
      // Ainda roteia envios via bridge para o service worker.
      handleSend(msg.job).then(sendResponse);
      return true;
    }
    if (msg?.type === "show_panel") { ensurePanel(); sendResponse({ ok: true }); return true; }
    return false;
  });

  // Envio silencioso via wa-bridge (MAIN world) — inalterado desde v0.9.
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
