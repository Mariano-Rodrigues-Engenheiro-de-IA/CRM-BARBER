// Ponte painel → extensão para ações dentro do WhatsApp Web.
//
// O painel roda em outra aba; quem tem acesso à sessão do WhatsApp é a
// extensão. Postamos uma mensagem que o `panel-nudge.js` encaminha ao
// service worker, que ativa a aba do WhatsApp e executa a ação.

import type { QuickReplyAction } from "@/lib/quick-replies";

export const WA_ACTION_REQUEST = "crm_wa_action_v190";
export const WA_ACTION_RESPONSE = "crm_wa_action_result_v190";

export type WaAction = {
  /** Telefone em dígitos (com ou sem DDI). */
  phone: string;
  /** Nome do cliente — usado para substituir {nome} nos textos. */
  name?: string;
  /** Só abrir a conversa, sem enviar nada. */
  openOnly?: boolean;
  /** Mensagem manual. */
  text?: string;
  /** Sequência de ações de uma resposta rápida. */
  actions?: QuickReplyAction[];
};

export function isRealPhone(phone: string | null | undefined) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 10 && !String(phone || "").startsWith("sem-tel");
}

export function sendWaAction(action: WaAction): Promise<{ ok: boolean; error?: string }> {
  if (typeof window === "undefined") return Promise.resolve({ ok: false, error: "Sem window" });
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve({ ok: false, error: "A extensão não respondeu. Abra o WhatsApp Web e tente de novo." });
    }, 60000);
    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.__crm !== WA_ACTION_RESPONSE || data.id !== id) return;
      clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve(data.payload ?? { ok: false, error: "Resposta vazia da extensão" });
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ __crm: WA_ACTION_REQUEST, id, action }, window.location.origin);
  });
}

/**
 * Abre a conversa no WhatsApp. Tenta pela extensão (mantém a sessão aberta);
 * se ela não responder, cai no link wa.me para o botão nunca ficar "morto".
 */
export async function openWhatsappChat(phone: string, name?: string) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!isRealPhone(digits)) return { ok: false, error: "Telefone inválido" };
  const r = await sendWaAction({ phone: digits, name, openOnly: true });
  if (!r.ok && typeof window !== "undefined") {
    window.open(`https://wa.me/${digits}`, "_blank", "noopener");
    return { ok: true };
  }
  return r;
}
