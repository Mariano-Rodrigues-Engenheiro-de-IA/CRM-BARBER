// BSP: 360dialog (API oficial da Meta via Partner API).
//
// Fluxo de Integrated Onboarding / Embedded Signup:
//   1. Abrimos o pop-up do hub:
//      {HUB_APP_URL}/{partner_id}/permissions?redirect_url=...&state=...
//   2. O cliente faz o login da Meta dentro do pop-up (em Coexistência,
//      escolhe o número que já usa no app WhatsApp Business).
//   3. O hub redireciona pro nosso callback com `client` e `channels`.
//   4. Trocamos isso por credenciais permanentes via Partner API:
//      POST /token                                        -> partner token
//      GET  /partners/{pid}/channels?filters={client_id}   -> dados do canal
//      POST /partners/{pid}/channels/{cid}/api_keys        -> D360-API-KEY
//   5. Envio: POST {WABA_URL}/messages com header D360-API-KEY (payload
//      idêntico ao da Cloud API oficial).
//
// Endpoints e nomes de campo podem variar por versão da Partner API — todo
// o resto do sistema fala pela interface BspAdapter, então ajustes ficam
// restritos a este arquivo.

import type { BspAdapter } from "./types";
import type { InstanceStatus, SendResult, SignupCallbackResult, StatusResult } from "../types";

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`${name} não configurada`);
  return v.replace(/\/+$/, "");
}

function hubUrl(): string {
  return env("D360_HUB_URL", "https://hub.360dialog.com/api/v2");
}

function hubAppUrl(): string {
  return env("D360_HUB_APP_URL", "https://hub.360dialog.com/dashboard/app");
}

function wabaUrl(): string {
  return env("D360_WABA_URL", "https://waba-v2.360dialog.io");
}

function partnerId(): string {
  return env("D360_PARTNER_ID");
}

type Json = Record<string, unknown>;

async function hub(path: string, opts: { method?: string; token?: string; body?: unknown } = {}): Promise<Json> {
  const res = await fetch(`${hubUrl()}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: Json = {};
  try {
    json = text ? (JSON.parse(text) as Json) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg =
      (typeof json.error === "string" && json.error) ||
      (typeof json.message === "string" && json.message) ||
      `HTTP ${res.status}`;
    throw new Error(`360dialog ${path}: ${msg}`);
  }
  return json;
}

/** Token de partner (curta duração) usado nas chamadas da Partner API. */
async function partnerToken(): Promise<string> {
  const json = await hub("/token", {
    method: "POST",
    body: {
      username: env("D360_PARTNER_USERNAME"),
      password: env("D360_PARTNER_PASSWORD"),
    },
  });
  const token =
    (typeof json.access_token === "string" && json.access_token) ||
    (typeof json.token === "string" && json.token) ||
    null;
  if (!token) throw new Error("360dialog: token de partner não retornado");
  return token;
}

function pickChannel(json: Json): Json | null {
  const list =
    (Array.isArray(json.partner_channels) && json.partner_channels) ||
    (Array.isArray(json.channels) && json.channels) ||
    (Array.isArray(json.data) && json.data) ||
    [];
  const first = list[0];
  return first && typeof first === "object" ? (first as Json) : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Coexistência: o canal criado a partir de um número que já rodava no app
 * WhatsApp Business vem marcado pelo hub. Os nomes variam entre releases,
 * então checamos os candidatos conhecidos e, na ausência de qualquer marca,
 * tratamos como número novo (Coexistência ainda não liberada na conta).
 */
function detectCoexistence(channel: Json, extra?: Record<string, string>): boolean {
  const flags = [
    channel.coexistence,
    channel.is_coexistence,
    (channel.setup_info as Json | undefined)?.coexistence,
    extra?.coexistence,
  ];
  if (flags.some((f) => f === true || f === "true")) return true;
  const type = str(channel.integration_type) ?? str(channel.onboarding_type) ?? extra?.integration_type ?? "";
  return /coexist/i.test(type);
}

function mapChannelStatus(channel: Json): InstanceStatus {
  const raw = (str(channel.status) ?? str(channel.current_status) ?? "").toLowerCase();
  if (["running", "connected", "active", "live"].includes(raw)) return "connected";
  if (["pending", "submitted", "in_progress", "waiting", "created"].includes(raw)) return "connecting";
  if (["deleted", "terminated", "revoked", "disabled"].includes(raw)) return "disconnected";
  return raw ? "connecting" : "connected";
}

export const dialog360Adapter: BspAdapter = {
  name: "360dialog",

  signupUrl({ state }) {
    const redirect = env("WHATSAPP_SIGNUP_REDIRECT_URL");
    const url = new URL(`${hubAppUrl()}/${partnerId()}/permissions`);
    url.searchParams.set("redirect_url", redirect);
    url.searchParams.set("state", state);
    return { url: url.toString(), params: { partner_id: partnerId() } };
  },

  async exchangeSignup({ code, extra }): Promise<SignupCallbackResult> {
    const token = await partnerToken();
    const pid = partnerId();

    // `code` = client id devolvido pelo hub. `extra.channels` pode trazer o
    // canal direto, evitando o filtro por cliente.
    const channelId = extra?.channel ?? (extra?.channels ? extra.channels.replace(/[[\]"']/g, "").split(",")[0] : null);

    let channel: Json | null = null;
    if (channelId) {
      const detail = await hub(`/partners/${pid}/channels/${channelId}`, { token });
      channel = pickChannel(detail) ?? detail;
    } else {
      const filters = encodeURIComponent(JSON.stringify({ client_id: code }));
      channel = pickChannel(await hub(`/partners/${pid}/channels?filters=${filters}`, { token }));
    }
    if (!channel) throw new Error("360dialog: canal não encontrado para este cliente");

    const cid = str(channel.id) ?? str(channel.channel_id) ?? channelId;
    if (!cid) throw new Error("360dialog: id do canal ausente");

    const keyRes = await hub(`/partners/${pid}/channels/${cid}/api_keys`, { method: "POST", token });
    const apiKey = str(keyRes.api_key) ?? str(keyRes.apiKey);
    if (!apiKey) throw new Error("360dialog: API key do canal não retornada");

    const waba = (channel.waba_account ?? channel.waba ?? {}) as Json;

    return {
      status: mapChannelStatus(channel),
      waba_id: str(waba.external_id) ?? str(waba.waba_id) ?? str(channel.waba_account_id) ?? cid,
      // No 360dialog o phone_number_id do canal é o próprio id do canal na
      // camada de mensagens (a API key já identifica o número).
      phone_number_id: str(channel.phone_number_id) ?? cid,
      access_token: apiKey,
      business_id: str(waba.business_id) ?? str(channel.client_id) ?? code,
      phone: (str(channel.setup_info && (channel.setup_info as Json).phone_number) ?? str(channel.phone_number))?.replace(
        /\D/g,
        "",
      ) ?? null,
      is_coexistence: detectCoexistence(channel, extra),
    };
  },

  async status({ access_token }): Promise<StatusResult> {
    const res = await fetch(`${wabaUrl()}/v1/configs/phone`, {
      headers: { "D360-API-KEY": access_token },
    });
    if (res.status === 401 || res.status === 403) return { status: "disconnected" };
    if (!res.ok) return { status: "connecting" };
    const json = (await res.json().catch(() => ({}))) as Json;
    const phone = str(json.display_phone_number) ?? str(json.phone_number);
    return { status: "connected", phone: phone ? phone.replace(/\D/g, "") : null, qrcode: null };
  },

  async sendText({ access_token, to, text }): Promise<SendResult> {
    try {
      const res = await fetch(`${wabaUrl()}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "D360-API-KEY": access_token },
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
          // 4xx (exceto 429) é erro de payload/permissão: não vale retentar.
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
