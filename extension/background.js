// Service worker: pareamento, polling da fila e roteamento de mensagens.
//
// Fluxo:
//  - Content script (WhatsApp Web) descobre o número logado e envia
//    `pair` com { phone }. Guardamos token + barbershop no storage.
//  - A cada N segundos, se pareado, buscamos o próximo job e pedimos
//    ao content script pra disparar. Ele confirma sent/failed.
//
// Rate limit: espaçamento aleatório entre 8s e 20s entre jobs (ritmo humano).

const DEFAULT_API_BASE = "https://buzz-boost-crm.lovable.app";
const POLL_MIN_MS = 8000;
const POLL_MAX_MS = 20000;
const POLL_ALARM_NAME = "crm-assinaturas-poll";

function randDelay() {
  return POLL_MIN_MS + Math.floor(Math.random() * (POLL_MAX_MS - POLL_MIN_MS));
}

async function getApiBase() {
  const { api_base } = await chrome.storage.local.get("api_base");
  return api_base || DEFAULT_API_BASE;
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
  const apiBase = await getApiBase();
  const url = `${apiBase}/api/public/extension/pair`;
  console.log("[CRM bg] pair →", url, { phone, install_id });
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, install_id, label: "Chrome" }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch { /* HTML response */ }
    console.log("[CRM bg] pair response", res.status, data, text.slice(0, 200));
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        error: data.error || `HTTP ${res.status} — verifique se ${apiBase} está no ar`,
        code: data.code,
      };
    }
    await chrome.storage.local.set({ token: data.token, barbershop: data.barbershop });
    return { ok: true, barbershop: data.barbershop };
  } catch (e) {
    console.error("[CRM bg] pair error", e);
    const msg = e?.name === "AbortError"
      ? `Timeout: ${apiBase} não respondeu em 15s`
      : `Erro de rede: ${String(e?.message || e)}`;
    return { ok: false, error: msg };
  }
}

async function fetchNextJob() {
  const { token } = await getAuth();
  if (!token) return null;
  const apiBase = await getApiBase();
  const res = await fetch(`${apiBase}/api/public/extension/jobs/next`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data.job || null;
}

async function reportJob(id, status, error) {
  const { token } = await getAuth();
  if (!token) return;
  const apiBase = await getApiBase();
  await fetch(`${apiBase}/api/public/extension/jobs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status, error }),
  }).catch(() => {});
}

async function ensureScripts(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["wa-js.js", "wa-bridge-v15.js"], world: "MAIN" }).catch(() => null);
  await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] }).catch(() => null);
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content-v15.js"] }).catch(() => null);
}

async function sendToTab(job) {
  const [tab] = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  if (!tab?.id) return { ok: false, error: "WhatsApp Web não está aberto" };
  await ensureScripts(tab.id);
  return await chrome.tabs.sendMessage(tab.id, { type: "send_message_v153", job });
}

async function showPanel() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("https://web.whatsapp.com/")) {
    return { ok: false, error: "Abra o WhatsApp Web e tente de novo." };
  }
  try {
    await ensureScripts(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { type: "show_panel" });
    return response?.ok ? { ok: true } : { ok: false, error: "Content script não respondeu." };
  } catch (e) {
    console.error("[CRM bg] show panel error", e);
    return { ok: false, error: String(e?.message || e) };
  }
}

let pollTimer = null;
let polling = false;
let lastPollStartedAt = 0;

function scheduleAlarm() {
  if (!chrome.alarms) return;
  // MV3 service workers can sleep and lose setTimeout. The alarm is the
  // reliable wake-up; the timeout keeps the 8s-20s human rhythm while alive.
  chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: 0.5 });
}

function clearAlarm() {
  if (!chrome.alarms) return;
  chrome.alarms.clear(POLL_ALARM_NAME).catch(() => {});
}

async function pollLoop() {
  clearTimeout(pollTimer);
  if (polling) return;
  polling = true;
  lastPollStartedAt = Date.now();
  try {
    const job = await fetchNextJob();
    if (job) {
      console.log("[CRM bg] job recebido", job.id, job.customer?.phone);
      const result = await sendToTab(job).catch((e) => ({ ok: false, error: String(e) }));
      await reportJob(job.id, result.ok ? "sent" : "failed", result.ok ? undefined : result.error);
      console.log("[CRM bg] job finalizado", job.id, result);
    }
  } catch (e) {
    console.warn("[CRM] poll error", e);
  } finally {
    polling = false;
  }
  pollTimer = setTimeout(pollLoop, randDelay());
  scheduleAlarm();
}

async function pollNow() {
  clearTimeout(pollTimer);
  await pollLoop();
}

async function apiCall(path, opts = {}) {
  const { token } = await getAuth();
  if (!token) return { ok: false, error: "Não vinculado" };
  const apiBase = await getApiBase();
  try {
    const res = await fetch(`${apiBase}${path}`, {
      method: opts.method || "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(opts.headers || {}),
      },
      body: opts.body,
    });
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch { /* */ }
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return data;
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === "pair") {
      const r = await pair(msg.phone);
      if (r.ok) {
        scheduleAlarm();
        pollLoop();
      }
      sendResponse(r);
    } else if (msg?.type === "get_status") {
      const auth = await getAuth();
      const api_base = await getApiBase();
      sendResponse({ paired: !!auth.token, barbershop: auth.barbershop || null, token: auth.token || null, api_base });
    } else if (msg?.type === "unpair") {
      await chrome.storage.local.remove(["token", "barbershop"]);
      clearTimeout(pollTimer);
      clearAlarm();
      sendResponse({ ok: true });
    } else if (msg?.type === "api") {
      sendResponse(await apiCall(msg.path, msg.opts || {}));
    } else if (msg?.type === "show_panel") {
      sendResponse(await showPanel());
    } else if (msg?.type === "poll_now") {
      await pollNow();
      sendResponse({ ok: true });
    }
  })();
  return true;
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.id && tab.url?.startsWith("https://web.whatsapp.com/")) {
    await ensureScripts(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: "show_panel" }).catch(() => null);
    return;
  }
  const [waTab] = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  if (waTab?.id) {
    await chrome.tabs.update(waTab.id, { active: true });
    return;
  }
  await chrome.tabs.create({ url: "https://web.whatsapp.com" });
});

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name !== POLL_ALARM_NAME) return;
  // If the worker woke up from sleep, continue consuming the campaign queue.
  // If a timeout poll started moments ago, avoid a duplicate claim attempt.
  if (Date.now() - lastPollStartedAt < 5000) return;
  pollLoop();
});

// Kick off polling if already paired on startup.
(async () => {
  const { token } = await getAuth();
  if (token) {
    scheduleAlarm();
    pollLoop();
  }
})();
