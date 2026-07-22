// Content script v0.6.0 — dockado no WhatsApp Web, integrado ao rail.
// Navegação: Home → Assinaturas (Ativos/Inadimplentes/Todos) → Disparo → Progresso.
//
// AVISO: seletores do WhatsApp podem quebrar sem aviso — mesma limitação do
// WaSeller e afins. O disparo abre a conversa do contato (limitação do
// WhatsApp Web SPA), mas o painel permanece visível o tempo todo e mostra o
// progresso da campanha em andamento.

(function () {
  const CRM_VERSION = "0.6.0";
  const BODY_DOCKED_CLASS = "crm-assinaturas-docked";
  const BODY_COLLAPSED_CLASS = "crm-assinaturas-docked-collapsed";
  if (window.__crmAssinaturasInjectedVersion === CRM_VERSION) return;
  window.__crmAssinaturasInjectedVersion = CRM_VERSION;
  document.getElementById("crm-assinaturas-panel")?.remove();
  document.body?.classList.remove(BODY_DOCKED_CLASS, BODY_COLLAPSED_CLASS);
  console.info(`[CRM ct v${CRM_VERSION}] carregado`, location.href);

  let panelRef = null;
  let currentScreen = "home";
  let currentSegment = "active"; // active | overdue | all
  let cachedCustomers = [];
  let campaignProgress = null; // { total, sent, failed, name }

  // --- Helpers ---
  const el = (tag, attrs = {}, children = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
      if (c == null) continue;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return n;
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const labelStatus = (s) => ({ active: "Ativo", overdue: "Inadimplente", reactivate: "Reativar", canceled: "Cancelado", lead: "Lead" }[s] || s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  // --- Painel ---
  function buildPanel() {
    const panel = el("div", { id: "crm-assinaturas-panel" });
    panel.innerHTML = `
      <div class="crm-header">
        <button class="crm-back crm-hidden" title="Voltar">‹</button>
        <span class="crm-logo">Assinaturas</span>
        <button class="crm-toggle" title="Recolher">‹</button>
      </div>
      <div class="crm-body"></div>
    `;
    document.body.appendChild(panel);
    document.body.classList.add(BODY_DOCKED_CLASS);
    document.body.classList.remove(BODY_COLLAPSED_CLASS);
    panelRef = panel;

    panel.querySelector(".crm-toggle").addEventListener("click", () => {
      const c = panel.classList.toggle("crm-collapsed");
      document.body.classList.toggle(BODY_COLLAPSED_CLASS, c);
      panel.querySelector(".crm-toggle").textContent = c ? "›" : "‹";
    });
    panel.querySelector(".crm-back").addEventListener("click", () => {
      if (currentScreen === "campaign" || currentScreen === "progress") renderAssinaturas();
      else renderHome();
    });

    renderHome();
    return panel;
  }

  function setScreen(name, title, showBack) {
    currentScreen = name;
    const header = panelRef.querySelector(".crm-header .crm-logo");
    header.textContent = title;
    panelRef.querySelector(".crm-back").classList.toggle("crm-hidden", !showBack);
  }

  function body() { return panelRef.querySelector(".crm-body"); }

  // --- HOME ---
  async function renderHome() {
    setScreen("home", "Assinaturas", false);
    const r = await chrome.runtime.sendMessage({ type: "get_status" });
    const paired = !!r?.paired;

    // Auto-pair silencioso
    if (!paired) {
      const phone = readLoggedPhone();
      if (phone) {
        chrome.runtime.sendMessage({ type: "pair", phone }).then((res) => {
          if (res?.ok) renderHome();
        });
      }
    }

    body().innerHTML = "";
    const status = el("div", { class: "crm-status" });
    status.innerHTML = paired
      ? `<strong>Vinculado</strong> — ${esc(r.barbershop?.name || "")}`
      : `Vinculando ao seu WhatsApp...`;
    body().appendChild(status);

    const tile = el("button", {
      class: "crm-tile",
      onclick: () => renderAssinaturas(),
    });
    tile.innerHTML = `<strong>Assinaturas</strong><small>Ativos, inadimplentes, disparos</small>`;
    body().appendChild(tile);

    if (paired) {
      const unpair = el("button", {
        class: "crm-ghost",
        style: "margin-top:16px",
        onclick: async () => {
          await chrome.runtime.sendMessage({ type: "unpair" });
          renderHome();
        },
      }, "Desvincular esta conta");
      body().appendChild(unpair);
    }
  }

  // --- ASSINATURAS (segmentos) ---
  async function renderAssinaturas() {
    setScreen("subs", "Assinaturas", true);
    body().innerHTML = `
      <div class="crm-subtabs">
        <button class="crm-subtab" data-seg="active">Ativos</button>
        <button class="crm-subtab" data-seg="overdue">Inadimplentes</button>
        <button class="crm-subtab" data-seg="all">Todos</button>
      </div>

      <div class="crm-actions">
        <label class="crm-csv-btn">
          Importar planilha<input type="file" class="crm-csv-in" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden />
        </label>
        <button class="crm-add-toggle">+ Adicionar</button>
      </div>

      <div class="crm-add-form crm-hidden">
        <input class="crm-in-name" placeholder="Nome" />
        <input class="crm-in-phone" placeholder="Telefone com DDD" />
        <button class="crm-add-sub">Salvar contato</button>
      </div>

      <div class="crm-msg"></div>

      <button class="crm-camp-open" style="margin-top:10px">🚀 Criar disparo para este segmento</button>

      <div class="crm-list"></div>
    `;

    const $ = (s) => body().querySelector(s);
    const $$ = (s) => Array.from(body().querySelectorAll(s));

    $$(".crm-subtab").forEach((b) => {
      b.classList.toggle("crm-subtab-active", b.dataset.seg === currentSegment);
      b.addEventListener("click", () => {
        currentSegment = b.dataset.seg;
        renderAssinaturas();
      });
    });

    $(".crm-add-toggle").addEventListener("click", () => {
      $(".crm-add-form").classList.toggle("crm-hidden");
    });

    $(".crm-add-sub").addEventListener("click", async () => {
      const msg = $(".crm-msg");
      const name = $(".crm-in-name").value.trim();
      const phone = $(".crm-in-phone").value.trim();
      if (!name || !phone) { msg.textContent = "Nome e telefone obrigatórios."; msg.classList.add("crm-err"); return; }
      msg.classList.remove("crm-err");
      msg.textContent = "Salvando...";
      const status = currentSegment === "all" ? "active" : currentSegment;
      const r = await api("/api/public/extension/customers", {
        method: "POST",
        body: JSON.stringify({ name, phone, status, tags: [] }),
      });
      if (r?.ok) {
        msg.textContent = "Contato adicionado.";
        $(".crm-in-name").value = ""; $(".crm-in-phone").value = "";
        loadList();
      } else {
        msg.classList.add("crm-err");
        msg.textContent = r?.error || "Erro ao adicionar";
      }
    });

    $(".crm-csv-in").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const msg = $(".crm-msg");
      msg.classList.remove("crm-err");
      msg.textContent = "Lendo planilha...";
      try {
        const text = await file.text();
        const rows = parseSpreadsheet(text, currentSegment === "all" ? "active" : currentSegment);
        if (!rows.length) {
          msg.classList.add("crm-err");
          msg.textContent = "Não achei linhas válidas. Precisa ter uma coluna com telefone.";
          e.target.value = ""; return;
        }
        msg.textContent = `Importando ${rows.length}...`;
        const r = await api("/api/public/extension/customers/import", {
          method: "POST",
          body: JSON.stringify({ customers: rows }),
        });
        if (r?.ok) {
          msg.textContent = `Importado: ${r.inserted} novos, ${r.updated} atualizados.`;
          loadList();
        } else {
          msg.classList.add("crm-err");
          msg.textContent = r?.error || "Erro na importação";
        }
      } catch (err) {
        msg.classList.add("crm-err");
        msg.textContent = "Erro ao ler arquivo: " + String(err?.message || err);
      }
      e.target.value = "";
    });

    $(".crm-camp-open").addEventListener("click", () => renderCampaign());

    loadList();

    async function loadList() {
      const list = $(".crm-list");
      list.textContent = "Carregando...";
      const r = await api("/api/public/extension/customers");
      if (!r?.ok) { list.textContent = r?.error || "Erro ao carregar"; return; }
      cachedCustomers = r.customers || [];
      const filtered = currentSegment === "all"
        ? cachedCustomers
        : cachedCustomers.filter((c) => c.status === currentSegment);
      if (!filtered.length) {
        list.innerHTML = `<p class="crm-empty">Nenhum contato aqui ainda.<br/>Importe uma planilha ou adicione manualmente.</p>`;
        return;
      }
      list.innerHTML = filtered.map((c) => `
        <div class="crm-card">
          <div><strong>${esc(c.name)}</strong> <small>${esc(c.phone)}</small></div>
          <div class="crm-cardrow"><span class="crm-pill crm-pill-${c.status}">${labelStatus(c.status)}</span></div>
        </div>
      `).join("");
    }
  }

  // --- CAMPANHA (criação) ---
  function renderCampaign() {
    setScreen("campaign", "Novo disparo", true);
    const segLabel = currentSegment === "active" ? "Ativos"
      : currentSegment === "overdue" ? "Inadimplentes" : "Todos";
    const total = currentSegment === "all"
      ? cachedCustomers.length
      : cachedCustomers.filter((c) => c.status === currentSegment).length;

    body().innerHTML = `
      <div class="crm-status">Segmento: <strong>${segLabel}</strong> · ${total} contato(s)</div>
      <input class="crm-camp-name" placeholder="Nome da campanha (ex: Cobrança julho)" />
      <select class="crm-camp-kind">
        <option value="text">Mensagem de texto</option>
        <option value="text" disabled>Imagem (em breve)</option>
        <option value="text" disabled>Áudio (em breve)</option>
      </select>
      <textarea class="crm-camp-msg" rows="5" placeholder="Escreva a mensagem que será enviada a cada contato"></textarea>
      <div class="crm-subrow">
        <input class="crm-camp-pace" type="number" min="8" max="600" value="30" title="Segundos entre disparos" />
        <span style="align-self:center;font-size:11px;color:#667781">seg. entre envios</span>
      </div>
      <button class="crm-camp-run">Iniciar campanha</button>
      <div class="crm-msg"></div>
      <p class="crm-hint">O envio roda em segundo plano com o WhatsApp aberto. O painel mostra o progresso enquanto as mensagens saem.</p>
    `;

    body().querySelector(".crm-camp-run").addEventListener("click", async () => {
      const msg = body().querySelector(".crm-msg");
      const name = body().querySelector(".crm-camp-name").value.trim();
      const message = body().querySelector(".crm-camp-msg").value.trim();
      const pace = Math.max(8, Number(body().querySelector(".crm-camp-pace").value) || 30);
      if (!name || !message) {
        msg.classList.add("crm-err");
        msg.textContent = "Nome e mensagem obrigatórios.";
        return;
      }
      msg.classList.remove("crm-err");
      msg.textContent = "Criando campanha...";
      const bodyPayload = { name, message, pace_seconds: pace };
      bodyPayload.filter = currentSegment === "all" ? {} : { status: currentSegment };
      const r = await api("/api/public/extension/campaigns", {
        method: "POST",
        body: JSON.stringify(bodyPayload),
      });
      if (!r?.ok) {
        msg.classList.add("crm-err");
        msg.textContent = r?.error || "Erro ao criar";
        return;
      }
      campaignProgress = { total: r.jobs_created, sent: 0, failed: 0, name };
      chrome.runtime.sendMessage({ type: "poll_now" });
      renderProgress();
    });
  }

  // --- PROGRESSO ---
  let progressTimer = null;
  function renderProgress() {
    setScreen("progress", "Campanha em andamento", true);
    body().innerHTML = `
      <div class="crm-status"><strong>${esc(campaignProgress?.name || "")}</strong></div>
      <div class="crm-progress"><div class="crm-progress-bar"></div></div>
      <div class="crm-progress-info">
        <span class="crm-p-done">0 / ${campaignProgress?.total || 0}</span>
        <span class="crm-p-pct">0%</span>
      </div>
      <p class="crm-hint" style="margin-top:12px">
        Mantenha esta aba do WhatsApp aberta. Os envios acontecem automaticamente
        em segundo plano — o painel continua visível durante todo o processo.
      </p>
      <div class="crm-actions" style="margin-top:16px">
        <button class="crm-ghost crm-p-back">Voltar aos assinantes</button>
      </div>
    `;
    body().querySelector(".crm-p-back").addEventListener("click", () => {
      if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
      renderAssinaturas();
    });
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = setInterval(updateProgress, 3000);
    updateProgress();
  }

  async function updateProgress() {
    if (currentScreen !== "progress") { clearInterval(progressTimer); progressTimer = null; return; }
    const r = await api("/api/public/extension/campaigns");
    if (!r?.ok || !r.campaigns?.length) return;
    const c = r.campaigns[0]; // mais recente
    const s = c.stats || { pending: 0, sent: 0, failed: 0 };
    const total = s.pending + s.sent + s.failed;
    const done = s.sent + s.failed;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const done$ = body().querySelector(".crm-p-done");
    const pct$ = body().querySelector(".crm-p-pct");
    const bar$ = body().querySelector(".crm-progress-bar");
    if (done$) done$.textContent = `${done} / ${total} (falhas: ${s.failed})`;
    if (pct$) pct$.textContent = pct + "%";
    if (bar$) bar$.style.width = pct + "%";
    if (total > 0 && s.pending === 0) {
      clearInterval(progressTimer); progressTimer = null;
    }
  }

  // --- Parser de planilha (CSV/TSV, cabeçalho opcional) ---
  function parseSpreadsheet(text, defaultStatus) {
    // Auto-detecta delimitador: ; (comum no Brasil), , ou tab.
    const firstLine = (text.split(/\r?\n/).find((l) => l.trim()) || "");
    const counts = { ";": (firstLine.match(/;/g) || []).length,
                     ",": (firstLine.match(/,/g) || []).length,
                     "\t": (firstLine.match(/\t/g) || []).length };
    const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ",";

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return [];

    // Cabeçalho? Detectamos se a primeira linha NÃO tem dígito de telefone.
    const firstCells = splitLine(lines[0], delim);
    const hasHeader = !firstCells.some((c) => /\d{8,}/.test(c.replace(/\D+/g, "")));

    let iName = 0, iPhone = 1, iStatus = -1, iTags = -1;
    let startIdx = 0;
    if (hasHeader) {
      startIdx = 1;
      const norm = firstCells.map((h) => h.toLowerCase().trim());
      const find = (...keys) => {
        for (const k of keys) {
          const i = norm.findIndex((h) => h.includes(k));
          if (i >= 0) return i;
        }
        return -1;
      };
      iName = find("nome", "name", "cliente", "contato");
      iPhone = find("telefone", "celular", "whats", "phone", "numero", "número");
      iStatus = find("status", "situa");
      iTags = find("tag", "etiqueta");
      if (iPhone < 0) {
        // sem coluna telefone identificada — procura primeira coluna com número
        iPhone = firstCells.findIndex((_, i) =>
          lines.slice(1, 6).some((l) => /\d{8,}/.test(splitLine(l, delim)[i]?.replace(/\D+/g, "") || ""))
        );
        if (iPhone < 0) return [];
      }
      if (iName < 0) iName = iPhone === 0 ? 1 : 0;
    } else {
      // Sem cabeçalho: tenta achar coluna com telefone.
      iPhone = firstCells.findIndex((c) => /\d{8,}/.test(c.replace(/\D+/g, "")));
      if (iPhone < 0) return [];
      iName = iPhone === 0 ? (firstCells.length > 1 ? 1 : 0) : 0;
    }

    const out = [];
    for (let l = startIdx; l < lines.length; l++) {
      const cells = splitLine(lines[l], delim);
      const rawPhone = cells[iPhone] || "";
      const phone = rawPhone.replace(/\D+/g, "");
      if (phone.length < 8) continue;
      const name = (cells[iName] || "").trim() || `Contato ${phone.slice(-4)}`;
      const row = { name, phone };
      if (iStatus >= 0) {
        const st = (cells[iStatus] || "").trim().toLowerCase();
        const map = { ativo: "active", active: "active",
                      inadimplente: "overdue", atrasado: "overdue", overdue: "overdue",
                      reativar: "reactivate", reactivate: "reactivate",
                      cancelado: "canceled", canceled: "canceled",
                      lead: "lead" };
        row.status = map[st] || defaultStatus;
      } else {
        row.status = defaultStatus;
      }
      if (iTags >= 0) {
        const tg = (cells[iTags] || "").trim();
        if (tg) row.tags = tg.split(/[;,|]/).map((t) => t.trim()).filter(Boolean);
      }
      out.push(row);
    }
    return out;
  }

  function splitLine(line, delim) {
    // Suporte simples a aspas duplas
    const out = []; let cur = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === delim && !inQ) { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  }

  function ensurePanelVisible() {
    if (!document.body) return false;
    try {
      const panel = panelRef || buildPanel();
      panel.classList.remove("crm-collapsed");
      document.body.classList.add(BODY_DOCKED_CLASS);
      document.body.classList.remove(BODY_COLLAPSED_CLASS);
      return true;
    } catch (e) {
      console.error(`[CRM ct v${CRM_VERSION}] erro`, e); return false;
    }
  }

  let attempts = 0;
  const wait = setInterval(() => {
    attempts += 1;
    if (ensurePanelVisible()) clearInterval(wait);
    else if (attempts >= 30) { clearInterval(wait); console.error(`[CRM ct v${CRM_VERSION}] painel não montou`); }
  }, 500);

  // --- Execução de disparo (recebe do background) ---
  async function waitFor(selector, timeout = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const e = document.querySelector(selector);
      if (e) return e;
      await sleep(300);
    }
    return null;
  }
  function clickLikeUser(target) {
    if (!target) return false;
    const btn = target.closest?.('button,[role="button"]') || target;
    btn.scrollIntoView?.({ block: "center" });
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    return true;
  }
  function findSendButton() {
    const cands = Array.from(document.querySelectorAll('button[aria-label], div[role="button"][aria-label]'));
    const byLabel = cands.find((e) => /^(enviar|send)$/i.test((e.getAttribute("aria-label") || "").trim()));
    if (byLabel) return byLabel;
    const icon = document.querySelector('span[data-icon="send"], span[data-testid="send"]');
    return icon?.closest?.('button,[role="button"]') || icon || null;
  }
  async function waitForSendButton(t = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < t) { const b = findSendButton(); if (b) return b; await sleep(250); }
    return null;
  }
  function fillComposerIfNeeded(box, body) {
    const cur = (box.innerText || box.textContent || "").trim();
    if (cur) return;
    box.focus();
    document.execCommand("insertText", false, body);
    box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: body }));
  }
  async function sendMessage(job) {
    const phone = (job.customer?.phone || job.phone || "").replace(/\D+/g, "");
    if (!phone) return { ok: false, error: "Sem telefone" };
    const body = job.body || job.rendered_body || "";
    console.info(`[CRM ct v${CRM_VERSION}] enviando`, { id: job.id, phone });
    // Navegação interna do SPA (não recarrega a página; painel continua visível)
    window.location.href = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(body)}`;
    const box = await waitFor('footer div[contenteditable="true"][role="textbox"], div[contenteditable="true"][data-tab="10"], footer div[contenteditable="true"]', 25000);
    if (!box) return { ok: false, error: "Caixa de mensagem não carregou" };
    await sleep(900);
    fillComposerIfNeeded(box, body);
    const btn = await waitForSendButton(15000);
    if (!btn) return { ok: false, error: "Botão enviar não apareceu" };
    if (!clickLikeUser(btn)) return { ok: false, error: "Não consegui clicar em enviar" };
    await sleep(2500);
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === "send_message") {
      sendMessage(msg.job).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
    if (msg?.type === "show_panel") { sendResponse({ ok: ensurePanelVisible() }); return true; }
  });
})();
