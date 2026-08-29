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

import type { BspAdapter, TemplateSummary } from "./types";
import type { SendResult, SignupCallbackResult, StatusResult } from "../types";

type Json = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function graphVersion(): string {
  return process.env.META_GRAPH_VERSION ?? "v26.0";
}

function graphUrl(path: string): string {
  return `https://graph.facebook.com/${graphVersion()}/${path}`;
}

/** Extrai uma mensagem de erro detalhada da resposta da Meta — inclui
 * código e detalhes extras (error_data.details), não só a mensagem curta.
 * Sem isso, erros genéricos (tipo "Authentication Error", "(#100) Invalid
 * parameter") ficavam sem contexto suficiente pra diagnosticar sem
 * precisar de acesso aos logs de servidor. */
function extractErrorMessage(json: Json, status: number): string {
  const errObj = json.error as Json | undefined;
  const message = typeof errObj?.message === "string" ? errObj.message : `HTTP ${status}`;
  const code = errObj?.code;
  const type = errObj?.type;
  const details = (errObj?.error_data as Json | undefined)?.details;
  const parts = [message];
  if (code !== undefined) parts.push(`code=${code}`);
  if (typeof type === "string") parts.push(`type=${type}`);
  if (typeof details === "string") parts.push(`details="${details}"`);
  return parts.join(" | ");
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
    if (!res.ok) {
      // Antes isso caía direto em "connecting" sem guardar o motivo —
      // dava a impressão de conexão travada pra sempre sem nenhuma pista
      // de por quê (ex: phone_number_id errado, permissão faltando).
      const errJson = (await res.json().catch(() => ({}))) as Json;
      const errMsg = (errJson.error as Json | undefined)?.message;
      return {
        status: "connecting",
        error: typeof errMsg === "string" ? errMsg : `Meta Graph respondeu HTTP ${res.status} ao consultar o número.`,
      };
    }
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
        return { ok: false, error: extractErrorMessage(json, res.status) };
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
        return {
          ok: false,
          error: extractErrorMessage(json, res.status),
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
        // Diagnóstico temporário: inclui um "raio-x" do token realmente
        // usado nessa chamada (início/fim/tamanho, nunca o valor
        // completo) — para confirmar, sem depender de logs de servidor,
        // se o valor que chega até aqui bate com o que está salvo no
        // banco, já que testes manuais com o mesmo token salvo passam,
        // mas o sistema real reporta token inválido (code=190).
        const tokenFingerprint = access_token
          ? `len=${access_token.length} start=${access_token.slice(0, 8)} end=${access_token.slice(-8)}`
          : "access_token vazio/undefined";
        return {
          ok: false,
          error: `${extractErrorMessage(json, res.status)} | token_usado[${tokenFingerprint}]`,
          retryable: res.status === 429 || res.status >= 500,
        };
      }
      const messages = Array.isArray(json.messages) ? (json.messages[0] as Json | undefined) : undefined;
      return { ok: true, provider_message_id: str(messages?.id) ?? undefined };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), retryable: true };
    }
  },

  async listTemplates({ access_token, waba_id }) {
    try {
      const url = new URL(graphUrl(`${waba_id}/message_templates`));
      url.searchParams.set("fields", "id,name,status,category,language,rejected_reason");
      url.searchParams.set("limit", "100");
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const json = (await res.json().catch(() => ({}))) as Json;
      if (!res.ok) {
        const error = (json.error as Json | undefined)?.message;
        return { ok: false, error: typeof error === "string" ? error : `HTTP ${res.status}` };
      }
      const data = Array.isArray(json.data) ? (json.data as Json[]) : [];
      const templates: TemplateSummary[] = data.map((t) => ({
        id: str(t.id) ?? "",
        name: str(t.name) ?? "",
        status: (str(t.status) ?? "PENDING") as TemplateSummary["status"],
        category: str(t.category) ?? "",
        language: str(t.language) ?? "",
        rejected_reason: str(t.rejected_reason),
      }));
      return { ok: true, templates };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  /** Upload de mídia pro cabeçalho de um modelo — a Meta exige uma sessão
   * de upload resumível (dois passos) antes de conseguir referenciar a
   * mídia num modelo. O handle devolvido aqui expira em ~24h, então o
   * modelo precisa ser criado logo em seguida.
   * https://developers.facebook.com/docs/graph-api/guides/upload */
  async uploadTemplateMedia({ data_base64, mime, filename }) {
    try {
      const appId = requireEnv("META_APP_ID");
      const appSecret = requireEnv("META_APP_SECRET");
      const bytes = Buffer.from(data_base64.split(",").pop() ?? data_base64, "base64");

      const sessionUrl = new URL(graphUrl(`${appId}/uploads`));
      sessionUrl.searchParams.set("file_name", filename);
      sessionUrl.searchParams.set("file_length", String(bytes.length));
      sessionUrl.searchParams.set("file_type", mime);
      sessionUrl.searchParams.set("access_token", `${appId}|${appSecret}`);
      const sessionRes = await fetch(sessionUrl.toString(), { method: "POST" });
      const sessionJson = (await sessionRes.json().catch(() => ({}))) as Json;
      if (!sessionRes.ok) {
        const error = (sessionJson.error as Json | undefined)?.message;
        return { ok: false, error: typeof error === "string" ? error : `Falha ao abrir sessão de upload (HTTP ${sessionRes.status}).` };
      }
      const sessionId = str(sessionJson.id);
      if (!sessionId) return { ok: false, error: "Meta não devolveu a sessão de upload." };

      const uploadRes = await fetch(graphUrl(sessionId), {
        method: "POST",
        headers: { Authorization: `OAuth ${appId}|${appSecret}`, "Content-Type": "application/octet-stream" },
        body: bytes,
      });
      const uploadJson = (await uploadRes.json().catch(() => ({}))) as Json;
      if (!uploadRes.ok) {
        const error = (uploadJson.error as Json | undefined)?.message;
        return { ok: false, error: typeof error === "string" ? error : `Falha ao enviar o arquivo (HTTP ${uploadRes.status}).` };
      }
      const handle = str(uploadJson.h);
      if (!handle) return { ok: false, error: "Meta não devolveu o handle da mídia enviada." };
      return { ok: true, handle };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async createTemplate({ access_token, waba_id, name, category, language_code, body_text, body_examples, header, footer_text, buttons, carousel }) {
    try {
      // Variáveis nomeadas ({{nome}}, {{data}}...) — bem mais claro que
      // {{1}}, {{2}} pra quem cria e edita os modelos depois.
      const varNames = Array.from(new Set(Array.from(body_text.matchAll(/\{\{([a-z0-9_]+)\}\}/g)).map((m) => m[1])));
      const hasVars = varNames.length > 0;

      // A documentação oficial da Meta usa minúsculas em todos os "type"
      // do payload de criação (body, header, carousel, buttons, url,
      // quick_reply) — maiúsculas passavam despercebido em modelos
      // simples, mas a validação do carrossel é mais rígida e rejeitava
      // com "Invalid parameter".
      const components: Json[] = [];
      if (header) {
        components.push({ type: "header", format: header.format.toLowerCase(), example: { header_handle: [header.handle] } });
      }
      const bodyComponent: Json = { type: "body", text: body_text };
      if (hasVars) {
        bodyComponent.example = {
          body_text_named_params: varNames.map((n) => ({ param_name: n, example: body_examples?.[n]?.trim() || n })),
        };
      }
      components.push(bodyComponent);

      if (footer_text?.trim()) {
        components.push({ type: "footer", text: footer_text.trim() });
      }

      if (buttons && buttons.length > 0) {
        components.push({
          type: "buttons",
          buttons: buttons.map((b) => {
            if (b.type === "URL") return { type: "url", text: b.text, url: b.url };
            if (b.type === "PHONE_NUMBER") return { type: "phone_number", text: b.text, phone_number: b.phone_number };
            return { type: "quick_reply", text: b.text };
          }),
        });
      }

      if (carousel && carousel.cards.length > 0) {
        components.push({
          type: "carousel",
          cards: carousel.cards.map((card) => {
            const cardComponents: Json[] = [
              { type: "header", format: card.header.format.toLowerCase(), example: { header_handle: [card.header.handle] } },
            ];
            if (card.body_text) cardComponents.push({ type: "body", text: card.body_text });
            if (card.buttons && card.buttons.length > 0) {
              cardComponents.push({
                type: "buttons",
                buttons: card.buttons.map((b) =>
                  b.type === "URL" ? { type: "url", text: b.text, url: b.url } : { type: "quick_reply", text: b.text },
                ),
              });
            }
            return { components: cardComponents };
          }),
        });
      }

      const res = await fetch(graphUrl(`${waba_id}/message_templates`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${access_token}`,
        },
        body: JSON.stringify({
          name,
          category: category.toLowerCase(),
          language: language_code,
          parameter_format: hasVars ? "named" : undefined,
          components,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as Json;
      if (!res.ok) {
        const errObj = (json.error as Json | undefined) ?? {};
        const parts = [errObj.error_user_title, errObj.error_user_msg, errObj.message]
          .filter((v): v is string => typeof v === "string" && v.length > 0);
        // Log completo (payload enviado + resposta da Meta) pro servidor —
        // "Invalid parameter" sozinho não diz QUAL parâmetro; com isso dá
        // pra investigar de verdade da próxima vez que acontecer.
        console.error("[createTemplate] Meta rejeitou:", JSON.stringify({ sent: components, response: json }).slice(0, 4000));
        return {
          ok: false,
          error: parts.length ? parts.join(" — ") : `HTTP ${res.status}${errObj.code ? ` (código ${errObj.code}${errObj.error_subcode ? `/${errObj.error_subcode}` : ""})` : ""}`,
        };
      }
      const id = str(json.id);
      if (!id) return { ok: false, error: "Meta não devolveu o ID do modelo criado." };
      return { ok: true, id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
