import { z } from "zod";

// Lembretes/Confirmações da Agenda — mensagem automática X minutos antes
// do horário do agendamento.
//
//  - "reminder": aviso informativo, não espera resposta. Manda texto
//    livre com variáveis {nome} {data} {hora} {servico} {profissional}
//    OU um modelo aprovado, dependendo do provedor conectado — número
//    conectado via Meta (API oficial) só entrega mensagem por modelo
//    aprovado; texto livre só funciona no provedor não oficial.
//  - "confirmation": manda um MODELO aprovado com botões de resposta
//    rápida (ex: "Confirmar" / "Cancelar"). Quando o cliente toca em
//    "Confirmar", o agendamento muda pra confirmed sozinho — a
//    correlação usa o WAMID da mensagem enviada (ver provider_message_id
//    em message_jobs e o webhook da Meta).

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
  confirm_button_text: z.string().trim().max(60).nullable().optional(),
  // Palavras/frases que, numa resposta DIGITADA (não só clique no
  // botão), contam como confirmação — comparado sem diferenciar
  // maiúsculas/acentos (ver normalizeForMatch abaixo).
  confirm_keywords: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  active: z.boolean().optional(),
});

export const agendaReminderRuleSchema = agendaReminderRuleBaseSchema
  .refine((v) => v.kind !== "reminder" || !!v.message_text?.trim() || !!v.template_name, {
    message: "Lembrete precisa de uma mensagem ou de um modelo.",
    path: ["message_text"],
  })
  .refine((v) => v.kind !== "confirmation" || (!!v.template_name && !!v.template_language), {
    message: "Confirmação precisa de um modelo aprovado com botões.",
    path: ["template_name"],
  });

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
  confirm_keywords: string[];
  active: boolean;
};

export const DEFAULT_CONFIRM_KEYWORDS = [
  "sim", "ok", "okay", "certo", "confirmo", "confirmado", "beleza", "blz", "ta bom", "tá bom",
];

/** Sem acento e minúsculo, pra comparar resposta digitada do cliente
 * contra as palavras configuradas sem depender de acento/maiúscula. */
export function normalizeForMatch(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** true se o texto digitado pelo cliente contém alguma das palavras de
 * confirmação da regra (comparação sem acento/maiúscula, por substring). */
export function textMatchesConfirmKeywords(text: string, keywords: string[]) {
  const normalized = normalizeForMatch(text);
  return keywords.some((k) => normalized.includes(normalizeForMatch(k)));
}

/** Substitui {nome} {data} {hora} {servico} {profissional} no texto —
 * mesma convenção de chaves usada nas Respostas Rápidas. */
export function renderAgendaReminderText(
  text: string,
  vars: { nome?: string; data?: string; hora?: string; servico?: string; profissional?: string },
) {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (vars as Record<string, string | undefined>)[k] ?? m);
}
