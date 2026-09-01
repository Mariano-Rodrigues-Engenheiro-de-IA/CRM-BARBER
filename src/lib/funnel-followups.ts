import { z } from "zod";
import { quickReplyActionSchema, type QuickReplyAction } from "@/lib/quick-replies";

// Follow-up por etapa de funil — sequência de mensagens programadas (dia
// 3 manda X, dia 7 manda Y...) que dispara conforme o tempo que o lead
// fica PARADO numa etapa (funnel_cards.stage_entered_at). Pré-configurado
// pelo próprio usuário — nenhuma IA envolvida por enquanto.

export const followupStepSchema = z
  .object({
    id: z.string().uuid().optional(), // presente ao editar um passo existente
    delay_minutes: z.number().int().min(0).max(60 * 24 * 90), // até 90 dias
    // Texto livre (só funciona no provedor não oficial) OU modelo
    // aprovado (obrigatório se conectado via Meta) — um dos dois.
    actions: z.array(quickReplyActionSchema).max(10).optional(),
    template_name: z.string().trim().max(512).nullable().optional(),
    template_language: z.string().trim().max(10).nullable().optional(),
    skip_if_replied: z.boolean().optional(),
  })
  .refine((v) => (v.actions && v.actions.length > 0) || !!v.template_name, {
    message: "Cada passo precisa de uma mensagem ou de um modelo.",
    path: ["actions"],
  });

export const funnelFollowupRuleSchema = z.object({
  funnel_id: z.string().uuid(),
  stage_id: z.string().uuid(),
  active: z.boolean().optional(),
  steps: z.array(followupStepSchema).min(1).max(20),
});

export type FollowupStep = {
  id: string;
  delay_minutes: number;
  actions: QuickReplyAction[];
  template_name: string | null;
  template_language: string | null;
  skip_if_replied: boolean;
  sort_order: number;
};

export type FunnelFollowupRule = {
  id: string;
  funnel_id: string;
  stage_id: string;
  active: boolean;
  steps: FollowupStep[];
};
