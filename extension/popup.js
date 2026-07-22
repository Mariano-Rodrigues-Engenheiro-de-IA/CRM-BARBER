const statusEl = document.getElementById("status");
const showPanelBtn = document.getElementById("show-panel");

showPanelBtn?.addEventListener("click", async () => {
  statusEl.textContent = "Abrindo painel...";
  try {
    const response = await chrome.runtime.sendMessage({ type: "show_panel" });
    statusEl.textContent = response?.ok
      ? "Painel aberto no WhatsApp Web."
      : response?.error || "Não consegui abrir o painel.";
  } catch (error) {
    statusEl.textContent = String(error?.message || error);
  }
});