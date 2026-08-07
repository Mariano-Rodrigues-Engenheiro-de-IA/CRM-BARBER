// Contrato do adaptador de BSP (Business Solution Provider) da API oficial.
//
// A lógica de Embedded Signup é parecida entre BSPs (pop-up → code/params →
// troca por credenciais → envio via Cloud API), mas cada um tem sua própria
// Partner API. Cada BSP vive em seu próprio arquivo neste diretório e é
// escolhido por `WHATSAPP_BSP`.

import type { SendResult, SignupCallbackResult, StatusResult } from "../types";

export type BspName = "360dialog" | "cloud";

export interface BspAdapter {
  readonly name: BspName;

  /** Monta a URL do pop-up de onboarding/Embedded Signup. */
  signupUrl(input: { barbershop_id: string; state: string }): {
    url: string;
    params?: Record<string, string>;
  };

  /**
   * Troca o retorno do pop-up por credenciais permanentes.
   * `code` é o identificador devolvido pelo BSP (no 360dialog é o
   * `client` id); `extra` traz os demais query params do redirect.
   */
  exchangeSignup(input: {
    code: string;
    barbershop_id: string;
    extra?: Record<string, string>;
  }): Promise<SignupCallbackResult>;

  /** Estado atual do número (somente leitura — não há QR aqui). */
  status(input: {
    access_token: string;
    phone_number_id?: string | null;
  }): Promise<StatusResult>;

  sendText(input: {
    access_token: string;
    phone_number_id?: string | null;
    to: string;
    text: string;
  }): Promise<SendResult>;

  /**
   * Envia um modelo de mensagem (message template) já aprovado pela Meta.
   * Necessário pra iniciar conversa fora da janela de 24h, ou pra mensagens
   * de marketing/notificação — texto livre (sendText) só funciona depois
   * que o cliente já mandou mensagem primeiro.
   */
  sendTemplate?(input: {
    access_token: string;
    phone_number_id?: string | null;
    to: string;
    template_name: string;
    /** Código de idioma do template, ex: "pt_BR", "en_US". */
    language_code: string;
    /** Textos das variáveis {{1}}, {{2}}... do corpo do template, na ordem. */
    body_params?: string[];
  }): Promise<SendResult>;

  /**
   * Registra o número na Cloud API (obrigatório antes do 1º envio — erro
   * 133010 "Account not registered"). Só existe onde o número é gerenciado
   * direto pela Meta; BSPs fazem isso por conta.
   */
  register?(input: {
    access_token: string;
    phone_number_id: string;
    pin: string;
  }): Promise<{ ok: boolean; error?: string }>;
}
