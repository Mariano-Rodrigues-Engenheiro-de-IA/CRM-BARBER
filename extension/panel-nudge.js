// Roda no painel web e conecta a página ao service worker da extensão.
(function () {
  if (window.__crmPanelNudgeVersion === "0.16.2") return;
  window.__crmPanelNudgeVersion = "0.16.2";

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data) return;
    if (data.__crm === "poll_now_v161") {
      chrome.runtime.sendMessage({ type: "poll_now" }).catch(() => null);
      return;
    }
    if (data.__crm !== "crm_api_request_v162") return;
    chrome.runtime
      .sendMessage({ type: "api", path: data.path, opts: data.opts || {} })
      .then((payload) => {
        window.postMessage({ __crm: "crm_api_response_v162", id: data.id, payload }, window.location.origin);
      })
      .catch((error) => {
        window.postMessage({
          __crm: "crm_api_response_v162",
          id: data.id,
          payload: { ok: false, error: String(error?.message || error) },
        }, window.location.origin);
      });
  });
})();