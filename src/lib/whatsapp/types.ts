// Interface única pro envio de WhatsApp.
//
// Toda a lógica de fila, painel e dispatcher fala com esta interface.
// A implementação real (UAZAPI hoje, Meta Cloud API amanhã) fica atrás
// de `provider.server.ts` — trocar de provider é uma variável de ambiente,
// nada mais.

/** Nome do provider ativo — gravado em `whatsapp_instances.provider`. */
export type ProviderName = "uazapi" | "meta";

/**
 * Como o número é vinculado:
 *  - "qr": QR code + polling de status (UAZAPI).
 *  - "embedded_signup": pop-up de login da Meta devolve um `code` que o
 *    servidor troca por token no callback (API oficial). Não há QR nem
 *    polling de pareamento.
 */
export type AuthMode = "qr" | "embedded_signup";

export type InstanceStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "hibernated";

export type ConnectResult = {
  instance_id: string;
  instance_token: string;
  status: InstanceStatus;
  qrcode?: string | null;
  /** true quando essa instância foi reaproveitada da IA (via a ponte de
   * unificação), não criada exclusivamente pelo CRM. Usado para decidir o
   * comportamento de "Desconectar" — numa instância compartilhada, isso
   * nunca deve derrubar a sessão real de WhatsApp. */
  shared_with_ai?: boolean;
  /** Preenchido quando `authMode === "embedded_signup"`: URL/config do pop-up. */
  signup?: {
    /** URL a abrir no navegador do usuário (ou null se o SDK do BSP cuida disso). */
    url?: string | null;
    /** Parâmetros do SDK (app_id, config_id, state…) quando aplicável. */
    params?: Record<string, string>;
  } | null;
};

export type StatusResult = {
  status: InstanceStatus;
  qrcode?: string | null;
  phone?: string | null;
  error?: string | null;
};

/** Resultado da troca do `code` do Embedded Signup por credenciais. */
export type SignupCallbackResult = {
  status: InstanceStatus;
  waba_id: string;
  phone_number_id: string;
  access_token: string;
  business_id?: string | null;
  phone?: string | null;
  /**
   * true quando o número já era usado no app WhatsApp Business e foi
   * vinculado em modo Coexistência (não é um número novo).
   */
  is_coexistence: boolean;
};

export type SendResult =
  | { ok: true; provider_message_id?: string }
  | { ok: false; error: string; retryable: boolean };


export interface WhatsAppProvider {
  /** Nome canônico — gravado em `whatsapp_instances.provider`. */
  readonly name: ProviderName;

  /** Como o vínculo do número acontece nesse provider. */
  readonly authMode: AuthMode;

  /** Cria (ou reaproveita) a instância da barbearia e devolve dados iniciais. */

  connect(input: {
    barbershop_id: string;
    existing_instance_id?: string | null;
    existing_instance_token?: string | null;
    /** Telefone do dono da barbearia — usado automaticamente pra consultar
     * se já existe uma instância ativa (ex: da IA) pra esse mesmo cliente,
     * evitando duas sessões WhatsApp Web concorrentes. Nunca pedido ao
     * usuário: já vem do cadastro da barbearia (mesmo campo usado pro
     * pareamento da extensão). Mais confiável que e-mail, que o usuário
     * pode digitar errado ou diferente entre os dois sistemas. */
    owner_phone?: string | null;
    /** Se a instância JÁ salva (existing_instance_*) já era compartilhada
     * com a IA numa chamada anterior — precisa ser repassado pra manter
     * esse status consistente entre reconexões. */
    existing_shared_with_ai?: boolean;
  }): Promise<ConnectResult>;

  /** Sincroniza status/QR/telefone atual da instância. */
  status(input: {
    instance_id: string;
    instance_token: string;
  }): Promise<StatusResult>;

  /** Envia texto. `to` é o telefone em dígitos (com DDI). */
  sendText(input: {
    instance_token: string;
    /** Só na API oficial: número emissor quando o token não o identifica. */
    phone_number_id?: string | null;
    to: string;
    text: string;
  }): Promise<SendResult>;

  /** Só na API oficial (Cloud API) — envio de modelo de mensagem aprovado. */
  sendTemplate?(input: {
    instance_token: string;
    phone_number_id?: string | null;
    to: string;
    template_name: string;
    language_code: string;
    body_params?: string[];
  }): Promise<SendResult>;

  /** Só na API oficial — lista modelos de mensagem com status de aprovação. */
  listTemplates?(input: { instance_token: string; waba_id: string }): Promise<
    | { ok: true; templates: import("./bsp/types").TemplateSummary[] }
    | { ok: false; error: string }
  >;

  /** Só na API oficial — cria um novo modelo de mensagem (entra em análise). */
  createTemplate?(input: {
    instance_token: string;
    waba_id: string;
    name: string;
    category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
    language_code: string;
    body_text: string;
  }): Promise<{ ok: true; id: string } | { ok: false; error: string }>;


  /** Desconecta/hiberna a instância (preserva credenciais). */
  disconnect(input: {
    instance_id: string;
    instance_token: string;
    /** Quando true, essa instância é compartilhada com a IA — desconectar
     * não deve derrubar a sessão real de WhatsApp, só pausar o uso local. */
    shared_with_ai?: boolean;
  }): Promise<void>;

  /**
   * Só em `authMode === "embedded_signup"`: troca o `code` devolvido pelo
   * pop-up da Meta por credenciais permanentes (WABA + phone_number_id +
   * token) e informa se o número entrou em modo Coexistência.
   */
  handleSignupCallback?(input: {
    code: string;
    barbershop_id: string;
    /** `state` devolvido pelo pop-up, quando o BSP repassa. */
    state?: string | null;
    /** Demais query params do redirect (ex.: `channels` no 360dialog). */
    extra?: Record<string, string>;
  }): Promise<SignupCallbackResult>;

}
