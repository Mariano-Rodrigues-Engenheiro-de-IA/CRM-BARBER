// Ponte de comunicação com a extensão do navegador, usada pelo painel web
// (src/routes/painel.tsx) pra chamar a API pública tanto direto (fetch
// normal) quanto via extensão (quando o token especial de bridge é usado).
// Extraído de painel.tsx pra reduzir o tamanho desse arquivo (era um dos
// 3 arquivos gigantes apontados na varredura de código morto/arquitetura).

export const EXTENSION_BRIDGE_TOKEN = "__extension_bridge__";
const EXTENSION_API_REQUEST = "crm_api_request_v180";
const EXTENSION_API_RESPONSE = "crm_api_response_v180";

function canUseExtensionBridge() {
  return typeof window !== "undefined";
}

export type ApiResult = { ok?: boolean; error?: string; [key: string]: unknown };

export async function apiViaExtension(path: string, opts: RequestInit = {}): Promise<ApiResult> {
  if (!canUseExtensionBridge()) {
    return { ok: false, error: "Bridge indisponível (ambiente sem window)." };
  }
  const method = opts.method || "GET";
  const id = crypto.randomUUID();
  console.info("[CRM painel] bridge →", method, path, id);
  return await new Promise<ApiResult>((resolve) => {
    const timeout = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      console.warn("[CRM painel] bridge timeout", method, path, id);
      resolve({
        ok: false,
        error: `Extensão não respondeu em 20s (${method} ${path}). Recarregue o WhatsApp Web e tente de novo.`,
      });
    }, 20000);
    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.__crm !== EXTENSION_API_RESPONSE || data.id !== id) return;
      clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      console.info("[CRM painel] bridge ←", method, path, id, data.payload);
      resolve(
        data.payload ?? { ok: false, error: data.error || "Erro na extensão (payload vazio)" },
      );
    }
    window.addEventListener("message", onMessage);
    window.postMessage(
      {
        __crm: EXTENSION_API_REQUEST,
        id,
        path,
        opts: {
          method,
          headers: opts.headers || {},
          body: typeof opts.body === "string" ? opts.body : undefined,
        },
      },
      window.location.origin,
    );
  });
}

export async function api(token: string, path: string, opts: RequestInit = {}) {
  if (token === EXTENSION_BRIDGE_TOKEN) {
    return await apiViaExtension(path, opts);
  }
  const res = await fetch(path, {
    ...opts,
    // Reforço do lado do navegador: o servidor já manda Cache-Control:
    // no-store, mas isso garante que nem o próprio fetch tenta usar uma
    // resposta guardada localmente antes de perguntar pro servidor.
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: `HTTP ${res.status}` };
  }
}
