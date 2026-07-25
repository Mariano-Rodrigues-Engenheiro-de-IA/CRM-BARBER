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
}
