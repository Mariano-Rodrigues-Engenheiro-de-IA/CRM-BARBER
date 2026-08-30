// Provider da API oficial da Meta, via BSP (configurável em `WHATSAPP_BSP`).
//
// Diferenças de fluxo em relação ao UAZAPI:
//  - authMode = "embedded_signup": não existe QR code nem polling de
//    pareamento. `connect()` devolve a URL do pop-up da Meta; quem finaliza
//    o vínculo é `handleSignupCallback()`, chamado pelo nosso callback HTTP.
//  - `status()` é só leitura do estado do número no BSP.
//  - Persistência: `instance_id` = phone_number_id e `instance_token` = token
//    de envio (mantém os campos antigos úteis pro dispatcher), além dos
//    campos específicos gravados pela rota de callback (waba_id, etc.).

import type { ConnectResult, SendResult, StatusResult, WhatsAppProvider } from "./types";
import { getBspAdapter } from "./bsp/index.server";
import { createSignupState } from "./signup-state.server";

export const metaProvider: WhatsAppProvider = {
  name: "meta",
  authMode: "embedded_signup",

  async connect({ barbershop_id, existing_instance_id, existing_instance_token }): Promise<ConnectResult> {
    const bsp = getBspAdapter();

    // Já vinculado: devolve o estado atual em vez de reabrir o signup.
    if (existing_instance_token) {
      const s = await bsp.status({
        access_token: existing_instance_token,
        phone_number_id: existing_instance_id ?? null,
      });
      if (s.status === "connected") {
        return {
          instance_id: existing_instance_id ?? "",
          instance_token: existing_instance_token,
          status: "connected",
          qrcode: null,
          signup: null,
        };
      }
    }

    const { url, params } = bsp.signupUrl({
      barbershop_id,
      state: createSignupState(barbershop_id),
    });

    return {
      // Credenciais só existem depois do callback — string vazia sinaliza
      // "não sobrescrever o que já está salvo".
      instance_id: existing_instance_id ?? "",
      instance_token: existing_instance_token ?? "",
      status: "connecting",
      qrcode: null,
      signup: { url, params },
    };
  },

  async status({ instance_id, instance_token }): Promise<StatusResult> {
    if (!instance_token) return { status: "disconnected" };
    return getBspAdapter().status({ access_token: instance_token, phone_number_id: instance_id ?? null });
  },

  async sendText({ instance_token, phone_number_id, to, text }): Promise<SendResult> {
    return getBspAdapter().sendText({
      access_token: instance_token,
      phone_number_id: phone_number_id ?? null,
      to,
      text,
    });
  },

  async sendTemplate({
    instance_token,
    phone_number_id,
    to,
    template_name,
    language_code,
    body_params,
    header_image_url,
  }): Promise<SendResult> {
    const bsp = getBspAdapter();
    if (!bsp.sendTemplate) {
      return { ok: false, error: "Provider atual não suporta envio de modelo.", retryable: false };
    }
    return bsp.sendTemplate({
      access_token: instance_token,
      phone_number_id: phone_number_id ?? null,
      to,
      template_name,
      language_code,
      body_params,
      header_image_url,
    });
  },

  async listTemplates({ instance_token, waba_id }) {
    const bsp = getBspAdapter();
    if (!bsp.listTemplates) {
      return { ok: false, error: "Provider atual não suporta listar modelos." };
    }
    return bsp.listTemplates({ access_token: instance_token, waba_id });
  },

  async uploadTemplateMedia({ data_base64, mime, filename }) {
    const bsp = getBspAdapter();
    if (!bsp.uploadTemplateMedia) {
      return { ok: false, error: "Provider atual não suporta enviar mídia de modelo." };
    }
    return bsp.uploadTemplateMedia({ data_base64, mime, filename });
  },

  async createTemplate({ instance_token, waba_id, name, category, language_code, body_text, body_examples, header, footer_text, buttons, carousel }) {
    const bsp = getBspAdapter();
    if (!bsp.createTemplate) {
      return { ok: false, error: "Provider atual não suporta criar modelos." };
    }
    return bsp.createTemplate({
      access_token: instance_token,
      waba_id,
      name,
      category,
      language_code,
      body_text,
      body_examples,
      header,
      footer_text,
      buttons,
      carousel,
    });
  },

  async editTemplate({ instance_token, template_id, category, body_text, body_examples, header, footer_text, buttons }) {
    const bsp = getBspAdapter();
    if (!bsp.editTemplate) {
      return { ok: false, error: "Provider atual não suporta editar modelos." };
    }
    return bsp.editTemplate({
      access_token: instance_token,
      template_id,
      category,
      body_text,
      body_examples,
      header,
      footer_text,
      buttons,
    });
  },

  async deleteTemplate({ instance_token, waba_id, name }) {
    const bsp = getBspAdapter();
    if (!bsp.deleteTemplate) {
      return { ok: false, error: "Provider atual não suporta excluir modelos." };
    }
    return bsp.deleteTemplate({ access_token: instance_token, waba_id, name });
  },

  async disconnect(): Promise<void> {
    // Na API oficial não existe "desconectar sessão": o número segue na WABA.
    // Paramos de disparar zerando o status local (feito pela rota) e o
    // desvínculo definitivo acontece no hub do BSP pelo próprio cliente.
  },

  async handleSignupCallback({ code, barbershop_id, state, extra }) {
    return getBspAdapter().exchangeSignup({
      code,
      barbershop_id,
      extra: { ...(extra ?? {}), ...(state ? { state } : {}) },
    });
  },
};
