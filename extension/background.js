// Service worker: pareamento, polling da fila e roteamento de mensagens.
//
// Fluxo:
//  - Content script (WhatsApp Web) descobre o número logado e envia
//    `pair` com { phone }. Guardamos token + barbershop no storage.
//  - A cada N segundos, se pareado, buscamos o próximo job e pedimos
//    ao content script pra disparar. Ele confirma sent/failed.
//
// Rate limit: espaçamento aleatório entre 8s e 20s entre jobs (ritmo humano).

const API_BASE = "https://buzz-boost-crm.lovable.app";
const POLL_MIN_MS = 8000;
const POLL_MAX_MS = 20000;

function randDelay() {
  return POLL_MIN_MS + Math.floor(Math.random() * (POLL_MAX_MS - POLL_MIN_MS));
}

async function getInstallId() {
  const { install_id } = await chrome.storage.local.get("install_id");
  if (install_id) return install_id;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ install_id: id });
  return id;
}

async function getAuth() {
  return await chrome.storage.local.get(["token", "barbershop"]);
}

async function pair(phone) {
  const install_id = await getInstallId();
  const res = await fetch(`${API_BASE}/api/public/extension/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, install_id, label: "Chrome" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    return { ok: false, error: data.error || `HTTP ${res.status}`, code: data.code };
  }
  await chrome.storage.local.set({ token: data.token, barbershop: data.barbershop });
  return { ok: true, barbershop: data.barbershop };
}

async function fetchNextJob() {
  const { token } = await getAuth();
  if (!token) return null;
  const res = await fetch(`${API_BASE}/api/public/extension/jobs/next`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.job || null;
}

async function reportJob(id, status, error) {
  const { token } = await getAuth();
  if (!token) return;
  await fetch(`${API_BASE}/api/public/extension/jobs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status, error }),
  });
}

async function sendToTab(job) {
  const [tab] = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  if (!tab?.id) return { ok: false, error: "WhatsApp Web não está aberto" };
  return await chrome.tabs.sendMessage(tab.id, { type: "send_message", job });
}

let pollTimer = null;
async function pollLoop() {
  clearTimeout(pollTimer);
  try {
    const job = await fetchNextJob();
    if (job) {
      const result = await sendToTab(job).catch((e) => ({ ok: false, error: String(e) }));
      await reportJob(job.id, result.ok ? "sent" : "failed", result.ok ? undefined : result.error);
    }
  } catch (e) {
    console.warn("[CRM] poll error", e);
  }
  pollTimer = setTimeout(pollLoop, randDelay());
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === "pair") {
      const r = await pair(msg.phone);
      if (r.ok) pollLoop();
      sendResponse(r);
    } else if (msg?.type === "get_status") {
      const auth = await getAuth();
      sendResponse({ paired: !!auth.token, barbershop: auth.barbershop || null });
    } else if (msg?.type === "unpair") {
      await chrome.storage.local.remove(["token", "barbershop"]);
      clearTimeout(pollTimer);
      sendResponse({ ok: true });
    }
  })();
  return true; // keep the message channel open for async response
});

// Kick off polling if already paired on startup.
(async () => {
  const { token } = await getAuth();
  if (token) pollLoop();
})();
