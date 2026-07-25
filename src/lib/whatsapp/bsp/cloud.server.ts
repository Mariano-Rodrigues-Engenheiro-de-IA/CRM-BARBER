// Adaptador da Cloud API oficial da Meta acessada DIRETO (sem BSP).
//
// Modo manual: o admin cria o app/WABA/número no Meta for Developers, gera um
// token permanente de Usuário do Sistema e cola `phone_number_id` +
// `access_token` na tela /admin/whatsapp. Não há Embedded Signup aqui —
// `signupUrl`/`exchangeSignup` são intencionalmente indisponíveis.

import type { BspAdapter } from "./types";
import type { SendResult, StatusResult } from "../types";

type Json = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function graphUrl(path: string): string {
  const version = process.env.META_GRAPH_VERSION ?? "v21.0";
  return `https://graph.facebook.com/${version}/${path}`;
}

export const cloudAdapter: BspAdapter = {
  name: "cloud",

  signupUrl() {
    throw new Error(
      "Conexão automática desativada: configure phone_number_id e access_token em /admin/whatsapp.",
    );
  },

  async exchangeSignup(): Promise<never> {
    throw new Error(
      "Conexão automática desativada: configure phone_number_id e access_token em /admin/whatsapp.",
    );
  },

  /** Lê o número no Graph API — serve como teste de credenciais. */
  async status({ access_token, phone_number_id }): Promise<StatusResult> {
    if (!access_token || !phone_number_id) return { status: "disconnected" };
    const res = await fetch(
      graphUrl(`${phone_number_id}?fields=display_phone_number,verified_name,quality_rating`),
      { headers: { Authorization: `Bearer ${access_token}` } },
    );
    if (res.status === 401 || res.status === 403) return { status: "disconnected" };
    if (!res.ok) return { status: "connecting" };
    const json = (await res.json().catch(() => ({}))) as Json;
    const phone = str(json.display_phone_number);
    return {
      status: "connected",
      phone: phone ? phone.replace(/\D/g, "") : null,
      qrcode: null,
    };
  },

  /** POST /{phone_number_id}/register — libera o número pra enviar (133010). */
  async register({ access_token, phone_number_id, pin }) {
    try {
      const res = await fetch(graphUrl(`${phone_number_id}/register`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${access_token}`,
        },
        body: JSON.stringify({ messaging_product: "whatsapp", pin }),
      });
      const json = (await res.json().catch(() => ({}))) as Json;
      if (!res.ok) {
        const error = (json.error as Json | undefined)?.message;
        return { ok: false, error: typeof error === "string" ? error : `HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async sendText({ access_token, phone_number_id, to, text }): Promise<SendResult> {
    if (!phone_number_id) {
      return { ok: false, error: "phone_number_id ausente na instância", retryable: false };
    }
    try {
      const res = await fetch(graphUrl(`${phone_number_id}/messages`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${access_token}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: to.replace(/\D/g, ""),
          type: "text",
          text: { preview_url: false, body: text },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as Json;
      if (!res.ok) {
        const error = (json.error as Json | undefined)?.message;
        return {
          ok: false,
          error: typeof error === "string" ? error : `HTTP ${res.status}`,
          retryable: res.status === 429 || res.status >= 500,
        };
      }
      const messages = Array.isArray(json.messages) ? (json.messages[0] as Json | undefined) : undefined;
      return { ok: true, provider_message_id: str(messages?.id) ?? undefined };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), retryable: true };
    }
  },
};
