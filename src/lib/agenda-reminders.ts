import { z } from "zod";

// Lembretes/Confirmações da Agenda — mensagem automática X minutos antes
// do horário do agendamento.
//
//  - "reminder": aviso informativo, texto livre com variáveis {nome}
//    {data} {hora} {servico} {profissional} OU modelo aprovado,
//    dependendo do provedor conectado.
//  - "confirmation": pede confirmação, com modelo aprovado com botões
//    (API oficial) OU texto livre pedindo resposta (fora da Meta). O
//    sistema só DISPARA a mensagem — não detecta clique de botão nem
//    resposta digitada automaticamente; confirmar o agendamento
//    continua sendo manual, na Agenda.

export const AGENDA_REMINDER_STATUS_OPTIONS = ["scheduled", "confirmed", "done", "canceled"] as const;

export const agendaReminderRuleBaseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["reminder", "confirmation"]),
  offset_minutes: z.number().int().min(0).max(60 * 24 * 30), // até 30 dias antes
  applies_to_statuses: z.array(z.enum(AGENDA_REMINDER_STATUS_OPTIONS)).min(1).default(["scheduled", "confirmed"]),
  message_text: z.string().trim().max(2000).nullable().optional(),
  template_name: z.string().trim().max(512).nullable().optional(),
  template_language: z.string().trim().max(10).nullable().optional(),
  // Só quando o modelo escolhido tiver cabeçalho de imagem — a Meta exige
  // isso em TODO envio, não só na criação do modelo (mesma regra já
  // corrigida no Disparo/campanha).
  template_header_media_path: z.string().trim().max(400).nullable().optional(),
  // Palavra usada na instrução de resposta do texto livre ("Responda X
  // para confirmar"), ou rótulo de referência do botão do modelo — não
  // aciona nenhuma detecção automática.
  confirm_button_text: z.string().trim().max(60).nullable().optional(),
  active: z.boolean().optional(),
});

export const agendaReminderRuleSchema = agendaReminderRuleBaseSchema
  .refine((v) => v.kind !== "reminder" || !!v.message_text?.trim() || !!v.template_name, {
    message: "Lembrete precisa de uma mensagem ou de um modelo.",
    path: ["message_text"],
  })
  .refine(
    (v) =>
      v.kind !== "confirmation" ||
      (!!v.template_name && !!v.template_language) ||
      !!v.message_text?.trim(),
    {
      // Confirmação por modelo (com botão) é exclusiva da API oficial;
      // fora dela, usa texto livre pedindo resposta — precisa de UM
      // dos dois, não só modelo.
      message: "Confirmação precisa de um modelo aprovado com botões, ou de uma mensagem de texto (fora da API oficial).",
      path: ["template_name"],
    },
  );

export type AgendaReminderRule = {
  id: string;
  name: string;
  kind: "reminder" | "confirmation";
  offset_minutes: number;
  applies_to_statuses: string[];
  message_text: string | null;
  template_name: string | null;
  template_language: string | null;
  confirm_button_text: string | null;
  active: boolean;
};

/** Substitui {nome} {data} {hora} {servico} {profissional} no texto —
 * mesma convenção de chaves usada nas Respostas Rápidas. */
export function renderAgendaReminderText(
  text: string,
  vars: { nome?: string; data?: string; hora?: string; servico?: string; profissional?: string },
) {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (vars as Record<string, string | undefined>)[k] ?? m);
}

/** Confirmação fora da API oficial não tem botão — precisa pedir uma
 * resposta digitada. Junta a mensagem configurada com uma instrução
 * clara, usando a mesma palavra do botão (confirm_button_text) que a
 * regra já guarda pro modelo da Meta, ou "Sim" como padrão. Só monta o
 * texto — não há detecção automática da resposta. */
export function renderConfirmationFreeText(
  messageText: string,
  vars: { nome?: string; data?: string; hora?: string; servico?: string; profissional?: string },
  confirmButtonText?: string | null,
) {
  const body = renderAgendaReminderText(messageText, vars);
  const word = confirmButtonText?.trim() || "Sim";
  return `${body}\n\nResponda "${word}" para confirmar.`;
}
