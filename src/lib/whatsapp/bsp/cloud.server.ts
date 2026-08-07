// Adaptador da Cloud API oficial da Meta acessada DIRETO (sem BSP).
//
// Dois caminhos de vínculo, ambos suportados:
//  1. Manual (admin): phone_number_id + access_token colados em /admin/whatsapp.
//  2. Cadastro Incorporado (Embedded Signup): o cliente faz login na Meta pelo
//     pop-up OAuth, autoriza a WABA e o `code` é trocado aqui por um token de
//     usuário do sistema da integração (não expira).
//
// Requer as variáveis META_APP_ID, META_APP_SECRET e (recomendado)
// META_CONFIG_ID, além de WHATSAPP_SIGNUP_REDIRECT_URL apontando para
// /api/public/whatsapp/signup-callback no domínio público do app.

import type { BspAdapter } from "./types";
import type { SendResult, SignupCallbackResult, StatusResult } from "../types";

type Json = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function graphVersion(): string {
  return process.env.META_GRAPH_VERSION ?? "v26.0";
}

function graphUrl(path: string): string {
  return `https://graph.facebook.com/${graphVersion()}/${path}`;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(
      `Cadastro Incorporado indisponível: variável ${name} não configurada. Configure-a ou use o modo manual em /admin/whatsapp.`,
    );
  }
  return v.trim();
}

function redirectUri(): string {
  return requireEnv("WHATSAPP_SIGNUP_REDIRECT_URL");
}

async function graphJson(url: string): Promise<Json> {
  const res = await fetch(url);
  const json = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) {
    const error = (json.error as Json | undefined)?.message;
    throw new Error(typeof error === "string" ? error : `Meta Graph HTTP ${res.status}`);
  }
  return json;
}

/** Lê o WABA autorizado a partir dos escopos granulares do token. */
function wabaFromScopes(debug: Json): string | null {
  const data = (debug.data ?? {}) as Json;
  const scopes = Array.isArray(data.granular_scopes) ? (data.granular_scopes as Json[]) : [];
  for (const scope of scopes) {
    if (str(scope.scope) === "whatsapp_business_management" || str(scope.scope) === "whatsapp_business_messaging") {
      const ids = Array.isArray(scope.target_ids) ? scope.target_ids : [];
      const first = str(ids[0]);
      if (first) return first;
    }
  }
  return null;
}

function businessFromScopes(debug: Json): string | null {
  const data = (debug.data ?? {}) as Json;
  const scopes = Array.isArray(data.granular_scopes) ? (data.granular_scopes as Json[]) : [];
  for (const scope of scopes) {
    if (str(scope.scope) === "business_management") {
      const ids = Array.isArray(scope.target_ids) ? scope.target_ids : [];
      const first = str(ids[0]);
      if (first) return first;
    }
  }
  return null;
}

export const cloudAdapter: BspAdapter = {
  name: "cloud",

  /** URL do pop-up OAuth do Cadastro Incorporado da Meta. */
  signupUrl({ state }) {
    const appId = requireEnv("META_APP_ID");
    const configId = requireEnv("META_CONFIG_ID");
    const url = new URL(`https://www.facebook.com/${graphVersion()}/dialog/oauth`);
    url.searchParams.set("client_id", appId);
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("override_default_response_type", "true");

    url.searchParams.set("config_id", configId);
    url.searchParams.set(
      "extras",
      JSON.stringify({ feature: "whatsapp_embedded_signup", sessionInfoVersion: 3, version: 3 }),
    );

    return { url: url.toString(), params: { app_id: appId, config_id: configId } };
  },

  /**
   * Troca o `code` do pop-up por token permanente, descobre a WABA e o número,
   * e assina o app nos webhooks da WABA.
   */
  async exchangeSignup({ code, extra }): Promise<SignupCallbackResult> {
    const appId = requireEnv("META_APP_ID");
    const appSecret = requireEnv("META_APP_SECRET");

    const tokenUrl = new URL(graphUrl("oauth/access_token"));
    tokenUrl.searchParams.set("client_id", appId);
    tokenUrl.searchParams.set("client_secret", appSecret);
    // O code devolvido pelo FB.login() não nasce de um redirect OAuth e deve
    // ser trocado sem redirect_uri. O fallback por diálogo OAuth, por outro
    // lado, exige o mesmo redirect_uri usado na autorização.
    if (extra?.source !== "sdk") {
      tokenUrl.searchParams.set("redirect_uri", redirectUri());
    }
    tokenUrl.searchParams.set("code", code);
    const tokenJson = await graphJson(tokenUrl.toString());
    const accessToken = str(tokenJson.access_token);
    if (!accessToken) throw new Error("Meta não devolveu access_token para este code.");

    const debugUrl = new URL(graphUrl("debug_token"));
    debugUrl.searchParams.set("input_token", accessToken);
    debugUrl.searchParams.set("access_token", `${appId}|${appSecret}`);
    const debug = await graphJson(debugUrl.toString());

    const wabaId = wabaFromScopes(debug);
    if (!wabaId) throw new Error("Nenhuma conta WhatsApp Business foi autorizada no Cadastro Incorporado.");

    const phones = await graphJson(
      `${graphUrl(`${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,platform_type,code_verification_status`)}&access_token=${encodeURIComponent(accessToken)}`,
    );
    const first = (Array.isArray(phones.data) ? (phones.data[0] as Json | undefined) : undefined) ?? {};
    const phoneNumberId = str(first.id);
    if (!phoneNumberId) throw new Error("A WABA autorizada ainda não tem número de telefone disponível.");

    // Assina o app nos webhooks da WABA (status de mensagem, respostas etc.).
    const subscriptionRes = await fetch(`${graphUrl(`${wabaId}/subscribed_apps`)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!subscriptionRes.ok) {
      const subscriptionJson = (await subscriptionRes.json().catch(() => ({}))) as Json;
      const subscriptionError = (subscriptionJson.error as Json | undefined)?.message;
      throw new Error(
        typeof subscriptionError === "string"
          ? `Número autorizado, mas não foi possível assinar os webhooks: ${subscriptionError}`
          : `Número autorizado, mas a assinatura dos webhooks falhou (HTTP ${subscriptionRes.status}).`,
      );
    }

    // Registro do número na Cloud API (evita o erro 133010 no 1º envio).
    // Só roda quando há PIN padrão configurado; falha aqui não invalida o
    // vínculo — o admin ainda pode registrar em /admin/whatsapp.
    const pin = process.env.META_REGISTER_PIN?.trim();
    if (pin && phoneNumberId) {
      await fetch(graphUrl(`${phoneNumberId}/register`), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ messaging_product: "whatsapp", pin }),
      }).catch(() => undefined);
    }



    const platform = (str(first.platform_type) ?? "").toUpperCase();

    return {
      status: "connected",
      waba_id: wabaId,
      phone_number_id: phoneNumberId,
      access_token: accessToken,
      business_id: businessFromScopes(debug),
      phone: str(first.display_phone_number)?.replace(/\D/g, "") ?? null,
      is_coexistence: platform === "SMB_APP",
    };
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

  async sendTemplate({
    access_token,
    phone_number_id,
    to,
    template_name,
    language_code,
    body_params,
  }): Promise<SendResult> {
    if (!phone_number_id) {
      return { ok: false, error: "phone_number_id ausente na instância", retryable: false };
    }
    try {
      const components =
        body_params && body_params.length > 0
          ? [
              {
                type: "body",
                parameters: body_params.map((text) => ({ type: "text", text })),
              },
            ]
          : undefined;
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
          type: "template",
          template: {
            name: template_name,
            language: { code: language_code },
            ...(components ? { components } : {}),
          },
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
