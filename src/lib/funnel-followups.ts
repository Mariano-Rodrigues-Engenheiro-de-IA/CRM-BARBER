import { z } from "zod";
import { quickReplyActionSchema, type QuickReplyAction } from "@/lib/quick-replies";

// Follow-up por etapa de funil — sequência de mensagens programadas (dia
// 3 manda X, dia 7 manda Y...) que dispara conforme o tempo que o lead
// fica PARADO numa etapa (funnel_cards.stage_entered_at). Pré-configurado
// pelo próprio usuário — nenhuma IA envolvida por enquanto.

export const followupStepSchema = z
  .object({
    id: z.string().uuid().optional(), // presente ao editar um passo existente
    delay_minutes: z
      .number()
      .int()
      .min(0)
      .max(60 * 24 * 90), // até 90 dias
    // Texto livre, mídia (imagem/vídeo/áudio) e/ou mover de funil/lista
    // (mesma estrutura já usada em Respostas Rápidas — vários blocos
    // por passo) OU modelo aprovado (obrigatório se conectado via Meta).
    actions: z.array(quickReplyActionSchema).max(10).optional(),
    template_name: z.string().trim().max(512).nullable().optional(),
    template_language: z.string().trim().max(10).nullable().optional(),
    // Só quando o modelo escolhido nesse passo tiver cabeçalho de imagem.
    template_header_media_path: z.string().trim().max(400).nullable().optional(),
  })
  .refine((v) => (v.actions && v.actions.length > 0) || !!v.template_name, {
    message: "Cada passo precisa de uma mensagem ou de um modelo.",
    path: ["actions"],
  });

export const funnelFollowupRuleSchema = z
  .object({
    name: z.string().trim().max(120).optional(),
    funnel_id: z.string().uuid(),
    stage_id: z.string().uuid(),
    active: z.boolean().optional(),
    // "entered": 1 mensagem só, contada a partir da entrada (tempo
    // configurável). "left_stage": 1 mensagem só, contada a partir da
    // saída. "time_in_stage": sequência de 1+ mensagens, cada uma com
    // seu próprio tempo — só esse modo permite mais de um passo.
    moment: z.enum(["entered", "left_stage", "time_in_stage"]).optional(),
    // Regra do follow-up inteiro (não mais por passo) — se o contato
    // respondeu depois do gatilho, para a sequência (não manda os
    // passos seguintes).
    skip_if_replied: z.boolean().optional(),
    // Só usado pela regra de Pós-venda — período (em dias) que o
    // contador da tesourinha (selinho numérico) olha pra trás.
    badge_period_days: z.number().int().min(1).max(365).optional(),
    steps: z.array(followupStepSchema).min(1).max(20),
  })
  .refine((v) => v.moment === "time_in_stage" || v.steps.length === 1, {
    message: '"Assim que entrar" e "Assim que sair" só permitem uma mensagem.',
    path: ["steps"],
  });

export type FollowupStep = {
  id: string;
  delay_minutes: number;
  actions: QuickReplyAction[];
  template_name: string | null;
  template_language: string | null;
  template_header_media_path: string | null;
  sort_order: number;
};

export type FunnelFollowupRule = {
  id: string;
  name: string | null;
  funnel_id: string;
  stage_id: string;
  active: boolean;
  trigger_type: "time_in_stage" | "left_stage";
  moment: "entered" | "left_stage" | "time_in_stage";
  skip_if_replied: boolean;
  badge_period_days: number;
  steps: FollowupStep[];
};
