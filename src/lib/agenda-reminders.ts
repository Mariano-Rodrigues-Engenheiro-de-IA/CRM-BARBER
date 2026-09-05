import { z } from "zod";

// Lembretes/Confirmações da Agenda — mensagem automática X minutos antes
// do horário do agendamento. Os dois tipos funcionam do mesmo jeito:
// texto livre com variáveis {nome} {primeiro_nome} {data} {hora}
// {servico} {profissional}, OU modelo aprovado (só a API oficial da
// Meta suporta modelo). O sistema só DISPARA a mensagem — não detecta
// resposta nem muda status de agendamento sozinho.

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
  active: z.boolean().optional(),
});

export const agendaReminderRuleSchema = agendaReminderRuleBaseSchema.refine(
  (v) => !!v.message_text?.trim() || (!!v.template_name && !!v.template_language),
  {
    message: "Precisa de uma mensagem de texto ou de um modelo aprovado.",
    path: ["message_text"],
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
  active: boolean;
};

/** Substitui {nome} {primeiro_nome} {data} {hora} {servico}
 * {profissional} no texto — mesma convenção de chaves usada nas
 * Respostas Rápidas. */
export function renderAgendaReminderText(
  text: string,
  vars: { nome?: string; primeiro_nome?: string; data?: string; hora?: string; servico?: string; profissional?: string },
) {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (vars as Record<string, string | undefined>)[k] ?? m);
}
