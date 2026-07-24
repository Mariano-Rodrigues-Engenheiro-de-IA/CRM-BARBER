// Roda no painel web e conecta a página ao service worker da extensão.
(function () {
  const NUDGE_VERSION = "0.18.25";
  if (window.__crmPanelNudgeVersion === NUDGE_VERSION) return;
  window.__crmPanelNudgeVersion = NUDGE_VERSION;
  console.info(`[CRM panel-nudge v${NUDGE_VERSION}] pronto`, location.href);

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data) return;
    if (data.__crm === "poll_now_v180" || data.__crm === "poll_now_v162" || data.__crm === "poll_now_v161") {
      chrome.runtime.sendMessage({ type: "poll_now" }).catch(() => null);
      return;
    }
    if (data.__crm !== "crm_api_request_v180" && data.__crm !== "crm_api_request_v162") return;
    const responseType = data.__crm === "crm_api_request_v180" ? "crm_api_response_v180" : "crm_api_response_v162";
    const method = String(data.opts?.method || "GET").toUpperCase();
    console.info("[CRM panel-nudge] →", method, data.path, data.id);
    chrome.runtime
      .sendMessage({ type: "api", path: data.path, opts: data.opts || {} })
      .then((payload) => {
        console.info("[CRM panel-nudge] ←", method, data.path, data.id, payload);
        window.postMessage({ __crm: responseType, id: data.id, payload }, window.location.origin);
      })
      .catch((error) => {
        const msg = String(error?.message || error);
        console.warn("[CRM panel-nudge] sendMessage falhou", method, data.path, data.id, msg);
        window.postMessage({
          __crm: responseType,
          id: data.id,
          payload: { ok: false, error: `Service worker da extensão não respondeu: ${msg}` },
        }, window.location.origin);
      });
  });
})();
