// Content script v0.11.0 — sidebar minimalista tipo "ponte" entre WhatsApp e o painel.
// Duas ações: Assinantes e Equipe (abrem o painel web em nova aba).
// Header com logo + nome da barbearia editáveis (armazenado local por barbearia).

(function () {
  const CRM_VERSION = "0.11.0";
  const BODY_DOCKED_CLASS = "crm-assinaturas-docked";
  const BODY_COLLAPSED_CLASS = "crm-assinaturas-docked-collapsed";
  if (window.__crmAssinaturasInjectedVersion === CRM_VERSION) return;
  window.__crmAssinaturasInjectedVersion = CRM_VERSION;
  document.getElementById("crm-assinaturas-panel")?.remove();
  document.body?.classList.remove(BODY_DOCKED_CLASS, BODY_COLLAPSED_CLASS);
  console.info(`[CRM ct v${CRM_VERSION}] carregado`, location.href);

  let panelRef = null;
  let currentShopId = null;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  function readLoggedPhone() {
    try {
      const raw = localStorage.getItem("last-wid-md") || localStorage.getItem("last-wid") || "";
      const m = raw.match(/(\d{8,15})/);
      return m ? m[1] : null;
    } catch { return null; }
  }

  function brandKey(shopId) { return `crm_brand_${shopId || "default"}`; }
  function readBrand(shopId) {
    try { return JSON.parse(localStorage.getItem(brandKey(shopId)) || "{}") || {}; }
    catch { return {}; }
  }
  function writeBrand(shopId, data) {
    localStorage.setItem(brandKey(shopId), JSON.stringify(data));
  }

  function buildPanel() {
    const panel = document.createElement("div");
    panel.id = "crm-assinaturas-panel";
    panel.className = "crm-theme-barber";
    panel.innerHTML = `
      <div class="crm-header">
        <span class="crm-logo-txt">Barber CRM</span>
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
        <div class="crm-empty-state">
          <div class="crm-empty-dot"></div>
          <p class="crm-empty-title">Conectando…</p>
          <p class="crm-empty-sub">Vinculando ao seu WhatsApp. Se demorar, atualize a página.</p>
        </div>
      `;
      return;
    }

    const info = r.barbershop || {};
    currentShopId = info.id || null;
    const token = r.token || "";
    const apiBase = r.api_base || "";
    const painelUrl = (section) =>
      `${apiBase}/painel?token=${encodeURIComponent(token)}${section ? `&section=${section}` : ""}`;

    const brand = readBrand(currentShopId);
    const displayName = brand.name || info.name || "Sua barbearia";
    const logo = brand.logo || "";
    const initial = displayName.trim().charAt(0).toUpperCase() || "B";

    body().innerHTML = `
      <div class="crm-brand">
        <button class="crm-avatar" title="Alterar logo">
          ${logo ? `<img src="${esc(logo)}" alt="logo" />` : `<span>${esc(initial)}</span>`}
        </button>
        <div class="crm-brand-info">
          <div class="crm-brand-name" title="${esc(displayName)}">${esc(displayName)}</div>
          <button class="crm-brand-edit">editar nome</button>
        </div>
        <input type="file" accept="image/*" class="crm-logo-input" hidden />
      </div>

      <div class="crm-tiles">
        <button class="crm-tile" data-section="assinantes">
          <div class="crm-tile-icon">💈</div>
          <div class="crm-tile-body">
            <div class="crm-tile-title">Assinantes</div>
            <div class="crm-tile-sub">CRM, planilhas & disparos</div>
          </div>
          <div class="crm-tile-arrow">→</div>
        </button>
        <button class="crm-tile" data-section="equipe">
          <div class="crm-tile-icon">🏆</div>
          <div class="crm-tile-body">
            <div class="crm-tile-title">Equipe</div>
            <div class="crm-tile-sub">Ranking, metas & gamificação</div>
          </div>
          <div class="crm-tile-arrow">→</div>
        </button>
      </div>

      <div class="crm-footer">
        <span class="crm-version">v${CRM_VERSION}</span>
        <button class="crm-unpair">desvincular</button>
      </div>
    `;

    body().querySelectorAll(".crm-tile").forEach((el) => {
      el.addEventListener("click", () => {
        window.open(painelUrl(el.getAttribute("data-section")), "_blank", "noopener");
      });
    });

    const avatarBtn = body().querySelector(".crm-avatar");
    const fileInput = body().querySelector(".crm-logo-input");
    avatarBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 400_000) {
        alert("Logo muito grande. Use uma imagem até 400KB.");
        return;
      }
      const dataUrl = await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.readAsDataURL(file);
      });
      const b = readBrand(currentShopId);
      writeBrand(currentShopId, { ...b, logo: dataUrl });
      render();
    });

    body().querySelector(".crm-brand-edit").addEventListener("click", () => {
      const b = readBrand(currentShopId);
      const next = prompt("Nome da barbearia:", displayName);
      if (next && next.trim()) {
        writeBrand(currentShopId, { ...b, name: next.trim() });
        render();
      }
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
