// Contrato do adaptador de BSP (Business Solution Provider) da API oficial.
//
// A lógica de Embedded Signup é parecida entre BSPs (pop-up → code/params →
// troca por credenciais → envio via Cloud API), mas cada um tem sua própria
// Partner API. Cada BSP vive em seu próprio arquivo neste diretório e é
// escolhido por `WHATSAPP_BSP`.

import type { SendResult, SignupCallbackResult, StatusResult } from "../types";

export type BspName = "360dialog" | "cloud";

export type TemplateSummary = {
  id: string;
  name: string;
  status: "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED" | string;
  category: string;
  language: string;
  /** Motivo da rejeição, quando status === "REJECTED". */
  rejected_reason?: string | null;
  last_updated_time?: string | null;
  /** Componentes crus da Meta — usado só pra decompor e preencher o
   * formulário de edição, não é exibido direto em lugar nenhum. */
  components?: unknown[];
};

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
    // URL (assinada, temporária) da imagem de cabeçalho do template — a
    // Meta exige isso a CADA envio quando o modelo tem cabeçalho de
    // imagem (não fica salvo no modelo aprovado em si).
    header_image_url?: string | null;
    // Uma URL por cartão do carrossel, na mesma ordem dos cartões no
    // modelo — mesma regra do header_image_url, só que um por cartão.
    carousel_card_image_urls?: string[] | null;
  }): Promise<SendResult>;

  /** Lista os modelos de mensagem (templates) da WABA, com status de
   * aprovação — pra gerenciar tudo pelo painel, sem precisar entrar no
   * Gerenciador do WhatsApp da Meta. */
  listTemplates?(input: { access_token: string; waba_id: string }): Promise<
    | { ok: true; templates: TemplateSummary[] }
    | { ok: false; error: string }
  >;

  /** Upload de mídia pro cabeçalho de um modelo — a Meta exige isso em
   * duas etapas (sessão de upload + envio dos bytes) antes de criar o
   * modelo em si; o modelo referencia o "handle" devolvido aqui, nunca o
   * arquivo direto. https://developers.facebook.com/docs/graph-api/guides/upload */
  uploadTemplateMedia?(input: {
    data_base64: string;
    mime: string;
    filename: string;
  }): Promise<{ ok: true; handle: string } | { ok: false; error: string }>;

  /** Cria um novo modelo de mensagem — entra em análise da Meta (minutos
   * a ~24h) antes de poder ser usado em sendTemplate. */
  createTemplate?(input: {
    access_token: string;
    waba_id: string;
    name: string;
    category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
    language_code: string;
    body_text: string;
    // Variáveis nomeadas ({{nome}}, {{data}}...) — a Meta exige um valor
    // de exemplo pra cada uma, senão a criação do modelo falha.
    body_examples?: Record<string, string>;
    // Cabeçalho de mídia opcional — "handle" vem de uploadTemplateMedia.
    header?: { format: "IMAGE" | "VIDEO" | "DOCUMENT"; handle: string } | null;
    // Texto de rodapé (cinza, pequeno) — sem variáveis, até 60 caracteres.
    footer_text?: string | null;
    // Botões do modelo (não confundir com os botões de cada cartão do
    // carrossel) — até 3, mistura de tipos permitida.
    buttons?: Array<
      | { type: "QUICK_REPLY"; text: string }
      | { type: "URL"; text: string; url: string }
      | { type: "PHONE_NUMBER"; text: string; phone_number: string }
    > | null;
    // Carrossel — só existe via API, a Meta nem oferece isso na interface
    // visual dela. Todos os cartões precisam ter o mesmo formato de mídia
    // e a mesma configuração de botões (regra da própria Meta).
    carousel?: {
      cards: Array<{
        header: { format: "IMAGE" | "VIDEO"; handle: string };
        body_text?: string;
        buttons?: Array<{ type: "URL" | "QUICK_REPLY"; text: string; url?: string }>;
      }>;
    } | null;
  }): Promise<{ ok: true; id: string } | { ok: false; error: string }>;

  /** Edita um modelo já existente — reenvia pra análise da Meta (volta pra
   * "em análise" mesmo que já estivesse aprovado). Aceita os mesmos
   * campos de createTemplate, exceto o nome (a Meta não permite renomear;
   * pra mudar o nome, precisa criar um modelo novo e excluir o antigo). */
  editTemplate?(input: {
    access_token: string;
    template_id: string;
    category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
    body_text: string;
    body_examples?: Record<string, string>;
    header?: { format: "IMAGE" | "VIDEO" | "DOCUMENT"; handle: string } | null;
    footer_text?: string | null;
    buttons?: Array<
      | { type: "QUICK_REPLY"; text: string }
      | { type: "URL"; text: string; url: string }
      | { type: "PHONE_NUMBER"; text: string; phone_number: string }
    > | null;
  }): Promise<{ ok: true } | { ok: false; error: string }>;

  /** Exclui um modelo pelo nome — remove todos os idiomas dele de uma vez
   * (é assim que a API da Meta funciona: exclusão é por nome, não por id
   * de um idioma específico). */
  deleteTemplate?(input: {
    access_token: string;
    waba_id: string;
    name: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;

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
