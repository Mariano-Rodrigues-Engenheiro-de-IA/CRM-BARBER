// Helper pro Meta Pixel (fbq). So dispara se o script do pixel ja carregou
// (window.fbq existe) - protege contra bloqueador de anuncio ou erro de rede,
// sem quebrar a pagina se o pixel nao estiver disponivel.
declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

export function trackPixelEvent(event: string, params?: Record<string, unknown>) {
  if (typeof window === "undefined" || typeof window.fbq !== "function") return;
  window.fbq("track", event, params);
}
