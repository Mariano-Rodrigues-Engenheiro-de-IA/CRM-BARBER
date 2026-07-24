// Interface única pro envio de WhatsApp.
//
// Toda a lógica de fila, painel e dispatcher fala com esta interface.
// A implementação real (UAZAPI hoje, Meta Cloud API amanhã) fica atrás
// de `provider.server.ts` — trocar de provider é uma variável de ambiente,
// nada mais.

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
};

export type StatusResult = {
  status: InstanceStatus;
  qrcode?: string | null;
  phone?: string | null;
};

export type SendResult =
  | { ok: true; provider_message_id?: string }
  | { ok: false; error: string; retryable: boolean };

export interface WhatsAppProvider {
  /** Cria (ou reaproveita) a instância da barbearia e devolve dados iniciais. */
  connect(input: {
    barbershop_id: string;
    existing_instance_id?: string | null;
    existing_instance_token?: string | null;
  }): Promise<ConnectResult>;

  /** Sincroniza status/QR/telefone atual da instância. */
  status(input: {
    instance_id: string;
    instance_token: string;
  }): Promise<StatusResult>;

  /** Envia texto. `to` é o telefone em dígitos (com DDI). */
  sendText(input: {
    instance_token: string;
    to: string;
    text: string;
  }): Promise<SendResult>;

  /** Desconecta/hiberna a instância (preserva credenciais). */
  disconnect(input: {
    instance_id: string;
    instance_token: string;
  }): Promise<void>;
}
