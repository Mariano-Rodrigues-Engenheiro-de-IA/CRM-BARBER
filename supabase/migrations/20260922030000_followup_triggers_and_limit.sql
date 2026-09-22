-- Histórico de mudança de etapa (funil normal OU "Listas", mesma
-- engrenagem) — não existia antes, só o momento da entrada na etapa
-- ATUAL era guardado (funnel_cards.stage_entered_at). Necessário pro
-- gatilho novo "saiu da etapa/lista": left_at NULL = ainda está nessa
-- etapa; preenchido = já saiu, e o cron de follow-up processa a saída
-- uma vez só (marcada em processed_left_at por regra, ver abaixo).
CREATE TABLE public.funnel_card_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES public.funnel_cards(id) ON DELETE CASCADE,
  funnel_id uuid NOT NULL,
  stage_id uuid NOT NULL,
  entered_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz
);
CREATE INDEX idx_stage_history_open ON public.funnel_card_stage_history (stage_id, card_id) WHERE left_at IS NULL;
CREATE INDEX idx_stage_history_left ON public.funnel_card_stage_history (stage_id, left_at) WHERE left_at IS NOT NULL;

-- Tipo de gatilho da regra — "time_in_stage" (já existia, é o padrão:
-- cada passo dispara conforme o tempo parado, "assim que entrar" é só
-- um passo com delay 0) ou "left_stage" (dispara quando o lead SAI da
-- etapa/lista, sem depender de quanto tempo ficou parado).
ALTER TABLE public.funnel_followup_rules
  ADD COLUMN trigger_type text NOT NULL DEFAULT 'time_in_stage'
    CHECK (trigger_type IN ('time_in_stage', 'left_stage')),
  ADD COLUMN max_messages_per_contact integer; -- null = sem limite

-- Evita reprocessar o mesmo passo de uma regra "left_stage" mais de uma
-- vez pro mesmo card+saída. É POR PASSO (não por saída inteira) de
-- propósito: um passo com espera longa (ex: 3 dias) precisa continuar
-- sendo reavaliado em rodadas futuras do cron até vencer, mesmo que
-- passos mais rápidos da mesma sequência já tenham disparado.
CREATE TABLE public.funnel_followup_left_stage_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.funnel_followup_rules(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES public.funnel_cards(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES public.funnel_followup_steps(id) ON DELETE CASCADE,
  left_at timestamptz NOT NULL,
  message_job_id uuid,
  UNIQUE (step_id, card_id, left_at)
);

