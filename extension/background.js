// Service worker: pareamento, polling da fila e roteamento de mensagens.
//
// Fluxo:
//  - Content script (WhatsApp Web) descobre o número logado e envia
//    `pair` com { phone }. Guardamos token + barbershop no storage.
//  - A cada N segundos, se pareado, buscamos o próximo job e pedimos
//    ao content script pra disparar. Ele confirma sent/failed.
//
// Rate limit: espaçamento aleatório entre 8s e 20s entre jobs (ritmo humano).

const EXTENSION_VERSION = "0.33.3";
const DEFAULT_API_BASE = "https://crm.zayloia.com";
const POLL_MIN_MS = 8000;
const POLL_MAX_MS = 20000;
const POLL_ALARM_NAME = "crm-assinaturas-poll";
const LAST_ERROR_KEY = "last_error";
const SCRIPT_REINJECTION_COOLDOWN_MS = 60000;
const lastScriptInjectionByTab = new Map();

function randDelay() {
  return POLL_MIN_MS + Math.floor(Math.random() * (POLL_MAX_MS - POLL_MIN_MS));
}

async function getApiBase() {
  const { api_base } = await chrome.storage.local.get("api_base");
  if (!api_base || api_base !== DEFAULT_API_BASE) {
    await chrome.storage.local.set({ api_base: DEFAULT_API_BASE });
    return DEFAULT_API_BASE;
  }
  return api_base;
}

async function setLastError(error) {
  const message = String(error || "Erro desconhecido").slice(0, 500);
  console.warn("[CRM bg]", message);
  await chrome.storage.local.set({ [LAST_ERROR_KEY]: message, last_error_at: new Date().toISOString() }).catch(() => {});
}

async function clearLastError() {
  await chrome.storage.local.remove([LAST_ERROR_KEY, "last_error_at"]).catch(() => {});
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
    await clearLastError();
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
    headers: { Authorization: `Bearer ${token}`, "X-CRM-Extension-Version": EXTENSION_VERSION },
    cache: "no-store",
  }).catch((e) => {
    // Falha de rede aqui é transitória (service worker acordando, aba offline,
    // preview sem sessão). O disparo real acontece no servidor, então isso não
    // é um erro que o usuário precisa ver no painel lateral.
    console.warn("[CRM bg] falha de rede ao buscar fila", String(e?.message || e));
    return null;
  });

  if (!res) return null;
  if (res.status === 401) {
    await chrome.storage.local.remove(["token", "barbershop"]);
    await setLastError("Token da extensão expirou/revogou. Atualize o WhatsApp Web para vincular novamente.");
    return null;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn(`[CRM bg] fila HTTP ${res.status}`, text.slice(0, 160));
    return null;
  }
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    console.warn("[CRM bg] fila retornou erro", data.error);
    return null;
  }
  if (data.job) await clearLastError();
  return data.job || null;

}

async function reportJob(id, status, error) {
  const { token } = await getAuth();
  if (!token) return;
  const apiBase = await getApiBase();
  const res = await fetch(`${apiBase}/api/public/extension/jobs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-CRM-Extension-Version": EXTENSION_VERSION },
    body: JSON.stringify({ status, error }),
  }).catch(() => {});
  if (!res?.ok) console.warn(`[CRM bg] falha ao reportar job ${id}: HTTP ${res?.status || "rede"}`);
}

async function ensureScripts(tabId) {
  const alive = await chrome.tabs
    .sendMessage(tabId, { type: "crm_content_ping" })
    .then((response) => response?.ok === true)
    .catch(() => false);
  if (alive) return;
  const lastInjection = lastScriptInjectionByTab.get(tabId) || 0;
  if (Date.now() - lastInjection < SCRIPT_REINJECTION_COOLDOWN_MS) return;
  lastScriptInjectionByTab.set(tabId, Date.now());
  await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] }).catch(() => null);
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content-v15.js"] }).catch(() => null);
}

function isWhatsappUrl(url) {
  return String(url || "").startsWith("https://web.whatsapp.com/");
}

async function preventTabDiscard(tabId) {
  if (!tabId) return false;
  try {
    // Não ativa a aba. Só informa ao Chrome que esta aba não deve ser
    // descartada automaticamente enquanto a extensão monitora o WhatsApp Web.
    await chrome.tabs.update(tabId, { autoDiscardable: false });
    return true;
  } catch (e) {
    console.warn("[CRM bg] não foi possível desativar descarte automático", e);
    return false;
  }
}

async function getWhatsappTabs() {
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  return tabs;
}

async function sendToTab(job) {
  const preparedJob = { ...job };
  if (Array.isArray(job?.actions) && job.actions.length) {
    preparedJob.actions = await prefetchMedia(job.actions);
    const broken = preparedJob.actions.find((action) => action?.media_error);
    if (broken) return { ok: false, error: broken.media_error };
  }
  const tabs = await getWhatsappTabs();
  const candidates = tabs
    .filter((tab) => tab.id)
    .sort((a, b) => Number(!!b.active) - Number(!!a.active));
  if (candidates.length === 0) return { ok: false, error: "WhatsApp Web não está aberto" };

  let lastError = "WhatsApp Web não respondeu";
  for (const tab of candidates) {
    try {
      if (tab.discarded) {
        lastError = "Aba do WhatsApp Web estava suspensa/descartada pelo Chrome. A extensão marcou a aba para não ser descartada daqui pra frente; abra/atualize o WhatsApp Web uma vez e tente novamente.";
        continue;
      }
      await ensureScripts(tab.id);
      const result = await chrome.tabs.sendMessage(tab.id, { type: "send_message_v180", job: preparedJob });
      if (result?.ok) return result;
      lastError = result?.error || lastError;
    } catch (e) {
      lastError = String(e?.message || e);
    }
  }
  return { ok: false, error: lastError };
}

// A página do WhatsApp Web tem CSP restritiva (connect-src): um fetch para o
// Storage feito de dentro dela é bloqueado silenciosamente e a mídia nunca é
// enviada. O service worker não tem essa restrição, então baixamos aqui e
// entregamos o arquivo já em base64 para a bridge montar o File.
function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

async function prefetchMedia(actions) {
  const out = [];
  for (const a of actions || []) {
    if (!a || a.type === "text" || !a.url) {
      out.push(a);
      continue;
    }
    try {
      const res = await fetch(a.url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      out.push({
        ...a,
        mime: a.mime || res.headers.get("content-type") || "application/octet-stream",
        data_base64: bytesToBase64(buf),
      });
    } catch (e) {
      out.push({ ...a, media_error: `Falha ao baixar mídia: ${String(e?.message || e)}` });
    }
  }
  return out;
}

// Ação disparada pelo painel (abrir conversa / enviar texto ou resposta rápida).
async function runWaAction(rawAction) {
  const action = { ...(rawAction || {}) };
  if (!action.openOnly && Array.isArray(action.actions) && action.actions.length) {
    action.actions = await prefetchMedia(action.actions);
    const broken = action.actions.find((a) => a.media_error);
    if (broken) return { ok: false, error: broken.media_error };
  }
  const tabs = await getWhatsappTabs();
  const candidates = tabs
    .filter((tab) => tab.id && !tab.discarded)
    .sort((a, b) => Number(!!b.active) - Number(!!a.active));
  if (candidates.length === 0) {
    return { ok: false, error: "Abra o WhatsApp Web em uma aba e tente de novo." };
  }
  let lastError = "WhatsApp Web não respondeu";
  for (const tab of candidates) {
    try {
      await ensureScripts(tab.id);
      const result = await chrome.tabs.sendMessage(tab.id, { type: "wa_action_v190", action });
      if (result?.ok) {
        // Só trazemos a aba pra frente quando o usuário pediu para abrir a conversa.
        if (action?.openOnly) {
          try {
            await chrome.tabs.update(tab.id, { active: true });
            if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
          } catch {}
        }
        return result;
      }
      lastError = result?.error || lastError;
    } catch (e) {
      lastError = String(e?.message || e);
    }
  }
  return { ok: false, error: lastError };
}


async function showPanel() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("https://web.whatsapp.com/")) {
    return { ok: false, error: "Abra o WhatsApp Web e tente de novo." };
  }
  try {
    await preventTabDiscard(tab.id);
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
    await getWhatsappTabs();
    const job = await fetchNextJob();
    if (job) {
      console.log("[CRM bg] job recebido", job.id, job.customer?.phone);
      const result = await sendToTab(job).catch((e) => ({ ok: false, error: String(e) }));
      if (!result.ok) await setLastError(`Falha no disparo: ${result.error || "erro desconhecido"}`);
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
      const err = await chrome.storage.local.get([LAST_ERROR_KEY, "last_error_at"]);
      sendResponse({ paired: !!auth.token, barbershop: auth.barbershop || null, token: auth.token || null, api_base, version: EXTENSION_VERSION, last_error: err[LAST_ERROR_KEY] || null, last_error_at: err.last_error_at || null });
    } else if (msg?.type === "unpair") {
      await chrome.storage.local.remove(["token", "barbershop"]);
      await clearLastError();
      clearTimeout(pollTimer);
      clearAlarm();
      sendResponse({ ok: true });
    } else if (msg?.type === "api") {
      const result = await apiCall(msg.path, msg.opts || {});
      sendResponse(result);
      const method = String(msg.opts?.method || "GET").toUpperCase();
      if (result?.ok && msg.path === "/api/public/extension/campaigns" && method === "POST") {
        await pollNow();
      }
    } else if (msg?.type === "show_panel") {
      sendResponse(await showPanel());
    } else if (msg?.type === "wa_action") {
      sendResponse(await runWaAction(msg.action || {}));
    } else if (msg?.type === "prefetch_media") {
      // Envio de resposta rápida disparado de dentro do WhatsApp Web: a página
      // não pode baixar a mídia (CSP), então baixamos aqui e devolvemos base64.
      const actions = await prefetchMedia(msg.actions || []);
      const broken = actions.find((a) => a?.media_error);
      sendResponse(broken ? { ok: false, error: broken.media_error } : { ok: true, actions });

    } else if (msg?.type === "poll_now") {

      await pollNow();
      sendResponse({ ok: true });
    }
  })();
  return true;
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.id && tab.url?.startsWith("https://web.whatsapp.com/")) {
    await preventTabDiscard(tab.id);
    await ensureScripts(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: "show_panel" }).catch(() => null);
    return;
  }
  const [waTab] = await getWhatsappTabs();
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

chrome.tabs.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && (isWhatsappUrl(changeInfo.url) || isWhatsappUrl(tab?.url))) {
    void preventTabDiscard(tabId);
  }
});

// Kick off polling if already paired on startup.
(async () => {
  // Limpa erros de fila antigos gravados por versões anteriores.
  await clearLastError();
  const { token } = await getAuth();
  if (token) {
    await getWhatsappTabs();
    scheduleAlarm();
    pollLoop();
  }

})();
