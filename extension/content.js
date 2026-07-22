// Content script — injeta um painel lateral dentro do WhatsApp Web e
// executa o envio real das mensagens da fila.
//
// AVISO DE FRAGILIDADE: os seletores abaixo dependem do DOM do WhatsApp Web,
// que muda sem aviso. Se qualquer um deles quebrar, o envio para. Isso é
// esperado no modelo "browser-based" (mesmo problema do WaSeller). O
// backend monitora falhas via health_events pra você detectar rapidamente.

(function () {
  if (window.__crmAssinaturasInjected) return;
  window.__crmAssinaturasInjected = true;

  // --- Descoberta do número logado ------------------------------------
  //
  // WhatsApp Web guarda o "wid" (id do usuário) em várias chaves do
  // localStorage. A mais estável historicamente é `last-wid-md`.
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

  // --- Painel lateral -------------------------------------------------
  function buildPanel() {
    const panel = document.createElement("div");
    panel.id = "crm-assinaturas-panel";
    panel.innerHTML = `
      <div class="crm-header">
        <span class="crm-logo">CRM Assinaturas</span>
        <button class="crm-toggle" title="Recolher">−</button>
      </div>
      <div class="crm-body">
        <div class="crm-status">Verificando...</div>
        <div class="crm-actions">
          <button class="crm-pair">Vincular esta conta</button>
        </div>
        <p class="crm-hint">Você precisa ter feito o cadastro em <a href="https://buzz-boost-crm.lovable.app" target="_blank">buzz-boost-crm.lovable.app</a> com o mesmo número.</p>
      </div>
    `;
    document.body.appendChild(panel);

    const statusEl = panel.querySelector(".crm-status");
    const pairBtn = panel.querySelector(".crm-pair");
    const toggleBtn = panel.querySelector(".crm-toggle");
    const body = panel.querySelector(".crm-body");

    toggleBtn.addEventListener("click", () => {
      const collapsed = panel.classList.toggle("crm-collapsed");
      toggleBtn.textContent = collapsed ? "+" : "−";
    });

    async function refresh() {
      const r = await chrome.runtime.sendMessage({ type: "get_status" });
      if (r?.paired) {
        statusEl.innerHTML = `<strong>Vinculado</strong><br><small>${r.barbershop?.name ?? ""}</small>`;
        pairBtn.textContent = "Desvincular";
        pairBtn.dataset.mode = "unpair";
      } else {
        statusEl.textContent = "Não vinculado";
        pairBtn.textContent = "Vincular esta conta";
        pairBtn.dataset.mode = "pair";
      }
    }

    pairBtn.addEventListener("click", async () => {
      if (pairBtn.dataset.mode === "unpair") {
        await chrome.runtime.sendMessage({ type: "unpair" });
        await refresh();
        return;
      }
      const phone = readLoggedPhone();
      console.log("[CRM ct] readLoggedPhone →", phone);
      if (!phone) {
        statusEl.textContent = "Não achei o número logado. Abra uma conversa no WhatsApp Web e tente de novo.";
        return;
      }
      pairBtn.disabled = true;
      statusEl.textContent = "Vinculando...";
      let r;
      try {
        r = await Promise.race([
          chrome.runtime.sendMessage({ type: "pair", phone }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("Sem resposta do background em 20s")), 20000)),
        ]);
      } catch (e) {
        r = { ok: false, error: String(e?.message || e) };
      }
      console.log("[CRM ct] pair result", r);
      pairBtn.disabled = false;
      if (r?.ok) {
        await refresh();
      } else {
        statusEl.textContent = r?.error || "Falha ao vincular";
      }
    });

    refresh();
  }

  // WhatsApp Web demora pra montar. Espera um pouco pra injetar.
  const wait = setInterval(() => {
    if (document.body) {
      clearInterval(wait);
      buildPanel();
    }
  }, 500);

  // --- Execução de disparo -------------------------------------------
  //
  // Abre um chat pelo phone, digita a mensagem e aperta enter.
  // Usa `wa.me/<phone>` que o WhatsApp Web resolve internamente via
  // deep-link `send/?phone=...&text=...`. Simples, mas eficaz pro MVP.
  async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function waitFor(selector, timeout = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(300);
    }
    return null;
  }

  async function sendMessage(job) {
    const phone = (job.customer?.phone || "").replace(/\D+/g, "");
    if (!phone) return { ok: false, error: "Sem telefone" };
    const body = job.body || "";

    // Deep-link interno do WhatsApp Web.
    const url = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(body)}`;
    // Navegação por history evita full reload.
    window.location.href = url;

    // Espera o campo de mensagem aparecer.
    const inputBox = await waitFor(
      'div[contenteditable="true"][data-tab="10"], footer div[contenteditable="true"]',
      20000,
    );
    if (!inputBox) return { ok: false, error: "Caixa de mensagem não carregou" };

    await sleep(1200);

    // O texto já vem pré-preenchido pelo deep-link; basta enviar.
    const sendBtn = document.querySelector(
      'button[aria-label="Enviar"], span[data-icon="send"], button[data-tab="11"]',
    );
    if (sendBtn) {
      sendBtn.click();
    } else {
      // Fallback: dispara "Enter".
      inputBox.focus();
      inputBox.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }),
      );
    }
    await sleep(1500);
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "send_message") {
      sendMessage(msg.job)
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
  });
})();
