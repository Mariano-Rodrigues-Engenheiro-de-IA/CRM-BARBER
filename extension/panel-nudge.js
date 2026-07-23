// Roda no painel web e acorda o service worker da extensão quando uma campanha é criada.
(function () {
  if (window.__crmPanelNudgeVersion === "0.16.0") return;
  window.__crmPanelNudgeVersion = "0.16.0";

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.__crm !== "poll_now_v160") return;
    chrome.runtime.sendMessage({ type: "poll_now" }).catch(() => null);
  });
})();