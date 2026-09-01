import { z } from "zod";
import { quickReplyActionSchema, type QuickReplyAction } from "@/lib/quick-replies";

// Follow-up por etapa de funil — sequência de mensagens programadas (dia
// 3 manda X, dia 7 manda Y...) que dispara conforme o tempo que o lead
// fica PARADO numa etapa (funnel_cards.stage_entered_at). Pré-configurado
// pelo próprio usuário — nenhuma IA envolvida por enquanto.

export const followupStepSchema = z.object({
  id: z.string().uuid().optional(), // presente ao editar um passo existente
  delay_minutes: z.number().int().min(0).max(60 * 24 * 90), // até 90 dias
  actions: z.array(quickReplyActionSchema).min(1).max(10),
  skip_if_replied: z.boolean().optional(),
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
