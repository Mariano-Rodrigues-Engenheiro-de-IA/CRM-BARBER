// Content script — painel lateral com abas dentro do WhatsApp Web.
// Abas: Vincular | Assinantes | Campanhas.
//
// AVISO DE FRAGILIDADE: os seletores de envio dependem do DOM do WhatsApp Web
// e podem quebrar sem aviso. Mesmo problema do WaSeller — o backend monitora
// falhas via health_events.

(function () {
  const CRM_VERSION = "0.5.0";
  const BODY_DOCKED_CLASS = "crm-assinaturas-docked";
  const BODY_COLLAPSED_CLASS = "crm-assinaturas-docked-collapsed";
  if (window.__crmAssinaturasInjectedVersion === CRM_VERSION) return;
  window.__crmAssinaturasInjectedVersion = CRM_VERSION;
  window.__crmAssinaturasInjected = false;
  document.getElementById("crm-assinaturas-panel")?.remove();
  document.body?.classList.remove(BODY_DOCKED_CLASS, BODY_COLLAPSED_CLASS);
  console.info(`[CRM ct v${CRM_VERSION}] content-v5 carregado`, location.href);

  let panelRef = null;

  // --- Descoberta do número logado ------------------------------------
  function readLoggedPhone() {
    try {
      const raw =
        localStorage.getItem("last-wid-md") ||
        localStorage.getItem("last-wid") ||
        "";
      const m = raw.match(/(\d{8,15})/);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }

  // --- Chamadas HTTP ao backend via background ------------------------
  async function api(path, opts = {}) {
    return await chrome.runtime.sendMessage({ type: "api", path, opts });
  }

  // --- Painel ---------------------------------------------------------
  function buildPanel() {
    const existing = document.getElementById("crm-assinaturas-panel");
    if (existing) {
      panelRef = existing;
      return existing;
    }

    const panel = document.createElement("div");
    panel.id = "crm-assinaturas-panel";
    panel.innerHTML = `
      <div class="crm-header">
        <span class="crm-logo">Assinaturas</span>
        <button class="crm-toggle" title="Recolher">‹</button>
      </div>
      <div class="crm-tabs">
        <button class="crm-tab crm-tab-active" data-tab="link">Conta</button>
        <button class="crm-tab" data-tab="subs">Assinantes</button>
        <button class="crm-tab" data-tab="camp">Disparos</button>
      </div>
      <div class="crm-body">
        <section class="crm-view" data-view="link">
          <div class="crm-status">Verificando...</div>
          <div class="crm-actions">
            <button class="crm-pair">Vincular esta conta</button>
          </div>
          <p class="crm-hint">Faça o cadastro em <a href="https://buzz-boost-crm.lovable.app" target="_blank">buzz-boost-crm.lovable.app</a> com o mesmo número.</p>
        </section>

        <section class="crm-view crm-hidden" data-view="subs">
          <div class="crm-subrow">
            <input class="crm-in-name" placeholder="Nome" />
            <input class="crm-in-phone" placeholder="Telefone com DDD" />
          </div>
          <div class="crm-subrow">
            <select class="crm-in-status">
              <option value="active">Ativo</option>
              <option value="overdue">Em atraso</option>
              <option value="reactivate">Reativar</option>
              <option value="lead">Lead</option>
            </select>
            <input class="crm-in-tags" placeholder="Tags (vírgula)" />
          </div>
          <div class="crm-actions">
            <button class="crm-add-sub">Adicionar</button>
            <label class="crm-csv-btn">
              Importar CSV<input type="file" class="crm-csv-in" accept=".csv,text/csv" hidden />
            </label>
          </div>
          <p class="crm-hint">CSV: <code>nome,telefone,status,tags</code> (tags separadas por <code>;</code>)</p>
          <div class="crm-msg"></div>
          <div class="crm-list"></div>
        </section>

        <section class="crm-view crm-hidden" data-view="camp">
          <input class="crm-camp-name" placeholder="Nome da campanha (ex: Venda de assinatura)" />
          <textarea class="crm-camp-msg" rows="4" placeholder="Mensagem que será enviada a cada contato"></textarea>
          <div class="crm-subrow">
            <select class="crm-camp-filter">
              <option value="">Todos os assinantes</option>
              <option value="active">Só ativos</option>
              <option value="overdue">Só em atraso</option>
              <option value="reactivate">Só reativar</option>
              <option value="lead">Só leads</option>
            </select>
            <input class="crm-camp-pace" type="number" min="5" max="600" value="30" title="Segundos entre disparos" />
          </div>
          <div class="crm-actions">
            <button class="crm-camp-run">Criar e disparar</button>
          </div>
          <p class="crm-hint">O envio acontece com o WhatsApp Web aberto, um contato por vez.</p>
          <div class="crm-msg"></div>
          <div class="crm-camp-list"></div>
        </section>
      </div>
    `;
    document.body.appendChild(panel);
    document.body.classList.add(BODY_DOCKED_CLASS);
    document.body.classList.remove(BODY_COLLAPSED_CLASS);
    panelRef = panel;
    console.info(`[CRM ct v${CRM_VERSION}] painel dockado no WhatsApp`);

    const $ = (s, r = panel) => r.querySelector(s);
    const $$ = (s, r = panel) => Array.from(r.querySelectorAll(s));

    $(".crm-toggle").addEventListener("click", () => {
      const c = panel.classList.toggle("crm-collapsed");
      document.body.classList.toggle(BODY_COLLAPSED_CLASS, c);
      $(".crm-toggle").textContent = c ? "›" : "‹";
    });

    function activateTab(which) {
      $$(".crm-tab").forEach((x) => x.classList.toggle("crm-tab-active", x.dataset.tab === which));
      $$(".crm-view").forEach((v) => {
        v.classList.toggle("crm-hidden", v.dataset.view !== which);
      });
      if (which === "subs") loadCustomers();
      if (which === "camp") loadCampaigns();
    }

    // Tabs
    $$(".crm-tab").forEach((t) => {
      t.addEventListener("click", () => {
        activateTab(t.dataset.tab);
      });
    });

    // ---- Vincular
    const statusEl = $(".crm-status");
    const pairBtn = $(".crm-pair");

    async function refreshLink() {
      const r = await chrome.runtime.sendMessage({ type: "get_status" });
      if (r?.paired) {
        statusEl.innerHTML = `<strong>Vinculado</strong><br><small>${r.barbershop?.name ?? ""}</small>`;
        pairBtn.textContent = "Desvincular";
        pairBtn.dataset.mode = "unpair";
        activateTab("subs");
      } else {
        const phone = readLoggedPhone();
        if (phone) {
          statusEl.textContent = "Vinculando automaticamente...";
          pairBtn.disabled = true;
          const paired = await pairCurrentWhatsApp(phone);
          pairBtn.disabled = false;
          if (paired) return;
        }
        statusEl.textContent = "Não vinculado";
        pairBtn.textContent = "Vincular esta conta";
        pairBtn.dataset.mode = "pair";
      }
    }

    async function pairCurrentWhatsApp(phone) {
      let r;
      try {
        r = await Promise.race([
          chrome.runtime.sendMessage({ type: "pair", phone }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("Sem resposta em 20s")), 20000)),
        ]);
      } catch (e) {
        r = { ok: false, error: String(e?.message || e) };
      }
      if (r?.ok) {
        await refreshLink();
        return true;
      }
      statusEl.textContent = r?.error || "Falha ao vincular";
      return false;
    }

    pairBtn.addEventListener("click", async () => {
      if (pairBtn.dataset.mode === "unpair") {
        await chrome.runtime.sendMessage({ type: "unpair" });
        await refreshLink();
        return;
      }
      const phone = readLoggedPhone();
      if (!phone) {
        statusEl.textContent = "Não achei o número logado. Abra uma conversa e tente de novo.";
        return;
      }
      pairBtn.disabled = true;
      statusEl.textContent = "Vinculando...";
      const ok = await pairCurrentWhatsApp(phone);
      pairBtn.disabled = false;
      if (!ok && !statusEl.textContent) statusEl.textContent = "Falha ao vincular";
    });

    // ---- Assinantes
    async function loadCustomers() {
      const list = $('[data-view="subs"] .crm-list');
      list.textContent = "Carregando...";
      const r = await api("/api/public/extension/customers");
      if (!r?.ok) {
        list.textContent = r?.error || "Erro ao carregar";
        return;
      }
      if (!r.customers.length) {
        list.innerHTML = '<p class="crm-empty">Nenhum assinante ainda.</p>';
        return;
      }
      list.innerHTML = r.customers
        .map((c) => {
          const tags = (c.tags || []).map((t) => `<span class="crm-tag">${escapeHtml(t)}</span>`).join("");
          return `<div class="crm-card">
            <div><strong>${escapeHtml(c.name)}</strong> <small>${escapeHtml(c.phone)}</small></div>
            <div class="crm-cardrow"><span class="crm-pill crm-pill-${c.status}">${labelStatus(c.status)}</span>${tags}</div>
          </div>`;
        })
        .join("");
    }

    $(".crm-add-sub").addEventListener("click", async () => {
      const msg = $('[data-view="subs"] .crm-msg');
      const name = $(".crm-in-name").value.trim();
      const phone = $(".crm-in-phone").value.trim();
      const status = $(".crm-in-status").value;
      const tags = $(".crm-in-tags").value.split(",").map((s) => s.trim()).filter(Boolean);
      if (!name || !phone) {
        msg.textContent = "Nome e telefone obrigatórios.";
        return;
      }
      msg.textContent = "Salvando...";
      const r = await api("/api/public/extension/customers", {
        method: "POST",
        body: JSON.stringify({ name, phone, status, tags }),
      });
      if (r?.ok) {
        msg.textContent = "Adicionado.";
        $(".crm-in-name").value = "";
        $(".crm-in-phone").value = "";
        $(".crm-in-tags").value = "";
        loadCustomers();
      } else {
        msg.textContent = r?.error || "Erro ao adicionar";
      }
    });

    $(".crm-csv-in").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const msg = $('[data-view="subs"] .crm-msg');
      msg.textContent = "Lendo arquivo...";
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length) {
        msg.textContent = "CSV vazio ou inválido.";
        return;
      }
      msg.textContent = `Importando ${rows.length}...`;
      const r = await api("/api/public/extension/customers/import", {
        method: "POST",
        body: JSON.stringify({ customers: rows }),
      });
      if (r?.ok) {
        msg.textContent = `Importados: ${r.inserted} novos, ${r.updated} atualizados.`;
        loadCustomers();
      } else {
        msg.textContent = r?.error || "Erro na importação";
      }
      e.target.value = "";
    });

    // ---- Campanhas
    async function loadCampaigns() {
      const list = $(".crm-camp-list");
      list.textContent = "Carregando...";
      const r = await api("/api/public/extension/campaigns");
      if (!r?.ok) {
        list.textContent = r?.error || "Erro";
        return;
      }
      if (!r.campaigns.length) {
        list.innerHTML = '<p class="crm-empty">Nenhuma campanha ainda.</p>';
        return;
      }
      list.innerHTML = r.campaigns
        .map((c) => {
          const s = c.stats || {};
          return `<div class="crm-card">
            <div><strong>${escapeHtml(c.name)}</strong></div>
            <div class="crm-cardrow"><small>Fila: ${s.pending || 0} · Enviadas: ${s.sent || 0} · Falhas: ${s.failed || 0}</small></div>
          </div>`;
        })
        .join("");
    }

    $(".crm-camp-run").addEventListener("click", async () => {
      const msg = $('[data-view="camp"] .crm-msg');
      const name = $(".crm-camp-name").value.trim();
      const message = $(".crm-camp-msg").value.trim();
      const filterStatus = $(".crm-camp-filter").value;
      const pace = Number($(".crm-camp-pace").value) || 30;
      if (!name || !message) {
        msg.textContent = "Nome e mensagem obrigatórios.";
        return;
      }
      msg.textContent = "Criando campanha...";
      const body = { name, message, pace_seconds: pace };
      body.filter = filterStatus ? { status: filterStatus } : {};
      const r = await api("/api/public/extension/campaigns", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (r?.ok) {
        msg.textContent = `Campanha criada — ${r.jobs_created} disparos na fila.`;
        $(".crm-camp-name").value = "";
        $(".crm-camp-msg").value = "";
        chrome.runtime.sendMessage({ type: "poll_now" });
        loadCampaigns();
      } else {
        msg.textContent = r?.error || "Erro ao criar";
      }
    });

    refreshLink();
    return panel;
  }

  function ensurePanelVisible() {
    if (!document.body) return false;
    try {
      const panel = panelRef || buildPanel();
      panel.classList.remove("crm-collapsed");
      document.body.classList.add(BODY_DOCKED_CLASS);
      document.body.classList.remove(BODY_COLLAPSED_CLASS);
      panel.style.display = "flex";
      panel.style.visibility = "visible";
      panel.style.opacity = "1";
      return true;
    } catch (e) {
      console.error(`[CRM ct v${CRM_VERSION}] erro ao montar painel`, e);
      return false;
    }
  }

  // --- Helpers --------------------------------------------------------
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }
  function labelStatus(s) {
    return { active: "Ativo", overdue: "Em atraso", reactivate: "Reativar", canceled: "Cancelado", lead: "Lead" }[s] || s;
  }
  function parseCsv(text) {
    // MVP: separador vírgula, primeira linha = cabeçalho.
    // Colunas aceitas: nome, telefone, status, tags (tags separadas por ;)
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];
    const head = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const idx = (k) => head.indexOf(k);
    const iName = idx("nome") >= 0 ? idx("nome") : idx("name");
    const iPhone = idx("telefone") >= 0 ? idx("telefone") : idx("phone");
    const iStatus = idx("status");
    const iTags = idx("tags");
    const out = [];
    for (let l = 1; l < lines.length; l++) {
      const cells = lines[l].split(",").map((c) => c.trim());
      const name = cells[iName];
      const phone = cells[iPhone];
      if (!name || !phone) continue;
      const row = { name, phone };
      const st = iStatus >= 0 ? cells[iStatus] : "";
      if (st && ["active", "overdue", "reactivate", "canceled", "lead"].includes(st)) row.status = st;
      const tg = iTags >= 0 ? cells[iTags] : "";
      if (tg) row.tags = tg.split(";").map((t) => t.trim()).filter(Boolean);
      out.push(row);
    }
    return out;
  }

  // WhatsApp Web demora pra montar; tentamos algumas vezes e registramos erro real.
  let attempts = 0;
  const wait = setInterval(() => {
    attempts += 1;
    if (ensurePanelVisible()) {
      clearInterval(wait);
    } else if (attempts >= 30) {
      clearInterval(wait);
      console.error(`[CRM ct v${CRM_VERSION}] painel não montou após 15s`);
    }
  }, 500);

  // --- Execução de disparo (recebe do background) ---------------------
  async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  async function waitFor(selector, timeout = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(300);
    }
    return null;
  }

  function clickLikeUser(el) {
    if (!el) return false;
    const target = el.closest?.('button,[role="button"]') || el;
    target.scrollIntoView?.({ block: "center", inline: "center" });
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    return true;
  }

  function findSendButton() {
    const labelled = Array.from(document.querySelectorAll('button[aria-label], div[role="button"][aria-label]'));
    const byLabel = labelled.find((el) => /^(enviar|send)$/i.test((el.getAttribute("aria-label") || "").trim()));
    if (byLabel) return byLabel;
    const icon = document.querySelector('span[data-icon="send"], span[data-testid="send"]');
    return icon?.closest?.('button,[role="button"]') || icon || null;
  }

  function composerHasText(inputBox, body) {
    const current = (inputBox.innerText || inputBox.textContent || "").trim();
    return current.length > 0 || !body.trim();
  }

  function fillComposerIfNeeded(inputBox, body) {
    if (composerHasText(inputBox, body)) return;
    inputBox.focus();
    document.execCommand("insertText", false, body);
    inputBox.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: body }));
  }

  async function waitForSendButton(timeout = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const btn = findSendButton();
      if (btn) return btn;
      await sleep(250);
    }
    return null;
  }

  async function sendMessage(job) {
    const phone = (job.customer?.phone || "").replace(/\D+/g, "");
    if (!phone) return { ok: false, error: "Sem telefone" };
    const body = job.body || "";
    console.info(`[CRM ct v${CRM_VERSION}] disparando job`, { id: job.id, phone });
    window.location.href = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(body)}`;
    const inputBox = await waitFor('footer div[contenteditable="true"][role="textbox"], div[contenteditable="true"][data-tab="10"], footer div[contenteditable="true"]', 25000);
    if (!inputBox) return { ok: false, error: "Caixa de mensagem não carregou" };
    await sleep(900);
    fillComposerIfNeeded(inputBox, body);
    const sendBtn = await waitForSendButton(15000);
    if (!sendBtn) return { ok: false, error: "Botão de enviar não apareceu" };
    if (!clickLikeUser(sendBtn)) return { ok: false, error: "Não consegui clicar no botão de enviar" };
    await sleep(2500);
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "send_message") {
      sendMessage(msg.job).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
    if (msg?.type === "show_panel") {
      sendResponse({ ok: ensurePanelVisible() });
      return true;
    }
  });
})();
