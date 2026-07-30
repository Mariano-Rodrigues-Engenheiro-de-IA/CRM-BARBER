// Ponte painel → extensão para ações dentro do WhatsApp Web.
//
// O painel roda em outra aba; quem tem acesso à sessão do WhatsApp é a
// extensão. Postamos uma mensagem que o `panel-nudge.js` encaminha ao
// service worker, que ativa a aba do WhatsApp e executa a ação.

import { funnelActions, type QuickReplyAction } from "@/lib/quick-replies";
import type { Funnel } from "@/lib/funnels";

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

/**
 * Telefone de verdade. IDs internos do WhatsApp (@lid) chegam como sequências
 * de 15+ dígitos — não são telefone e nunca podem aparecer/serem discados.
 */
export function isRealPhone(phone: string | null | undefined) {
  const raw = String(phone || "");
  if (raw.startsWith("sem-tel")) return false;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 13;
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
 * se ela não responder e houver telefone real, cai no link wa.me.
 * Sem telefone formatado, usa o ID do WhatsApp (wa_id) — a extensão resolve.
 */
export async function openWhatsappChat(phone: string, name?: string, waId?: string | null) {
  const digits = String(phone || "").replace(/\D/g, "");
  const real = isRealPhone(digits);
  const target = real ? digits : String(waId || "").replace(/\D/g, "");
  if (!target) return { ok: false, error: "Contato sem telefone ou ID do WhatsApp" };
  const r = await sendWaAction({ phone: target, name, openOnly: true });
  if (!r.ok && real && typeof window !== "undefined") {
    window.open(`https://wa.me/${digits}`, "_blank", "noopener");
    return { ok: true };
  }
  return r;
}

/** Botão do WhatsApp fica ativo se houver telefone real OU ID do WhatsApp. */
export function canOpenWhatsapp(phone: string | null | undefined, waId?: string | null) {
  return isRealPhone(phone) || !!String(waId || "").replace(/\D/g, "");
}

/**
 * Aplica as ações de funil de uma resposta rápida depois do envio:
 * adiciona o contato numa etapa e/ou remove ele de outro funil.
 */
export async function applyFunnelActions(
  api: (path: string, opts?: RequestInit) => Promise<Record<string, unknown>>,
  actions: QuickReplyAction[],
  target: { title: string; phone: string },
) {
  const list = funnelActions(actions);
  if (list.length === 0) return;
  const digits = String(target.phone || "").replace(/\D/g, "");

  const r = await api("/api/public/extension/funnels");
  const funnels = (r?.ok ? (r.funnels as Funnel[]) : []) || [];

  for (const a of list) {
    if (a.type === "funnel_add" && a.funnel_id && a.stage_id) {
      const existing = funnels
        .find((f) => f.id === a.funnel_id)
        ?.cards.find((c) => String(c.phone || "").replace(/\D/g, "") === digits);
      if (existing) {
        // Já está no funil: move para a etapa configurada (antes ficava parado).
        if (existing.stage_id !== a.stage_id) {
          await api("/api/public/extension/funnel-cards", {
            method: "PATCH",
            body: JSON.stringify({ id: existing.id, stage_id: a.stage_id }),
          });
        }
        continue;
      }
      await api("/api/public/extension/funnel-cards", {
        method: "POST",
        body: JSON.stringify({
          funnel_id: a.funnel_id,
          stage_id: a.stage_id,
          title: target.title,
          phone: digits,
        }),
      });
      continue;

    }
    if (a.type === "funnel_remove" && a.funnel_id) {
      const cards = (funnels.find((f) => f.id === a.funnel_id)?.cards ?? []).filter(
        (c) => String(c.phone || "").replace(/\D/g, "") === digits,
      );
      for (const c of cards) {
        await api("/api/public/extension/funnel-cards", {
          method: "DELETE",
          body: JSON.stringify({ id: c.id }),
        });
      }
    }
  }
}
