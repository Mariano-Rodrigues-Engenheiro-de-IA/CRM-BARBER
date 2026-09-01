-- Duas funcionalidades novas pedidas pelo Mariano:
--  1) Lembretes/Confirmações da Agenda — mensagem automática X tempo antes
--     do agendamento. Confirmação usa um modelo aprovado COM BOTÕES de
--     resposta rápida (não texto livre): quando o cliente toca no botão
--     "Confirmar", o WhatsApp manda um evento estruturado pro webhook da
--     Meta (não precisa interpretar texto — mais confiável).
--  2) Follow-up por etapa de funil — sequência de mensagens programadas
--     que dispara conforme o tempo que o lead fica parado numa etapa.
--
-- Infra compartilhada: as duas reaproveitam a fila message_jobs que já
-- existe (mesma usada por campanhas e agendamento manual) — só precisam
-- de um jeito de rastrear qual WAMID (id da mensagem na Meta) cada job
-- gerou, pra poder casar a resposta do botão de volta com o agendamento.

-- ---------------------------------------------------------------------
-- 0) Rastreio do WAMID de saída — necessário pra casar a resposta do
--    botão de confirmação de volta com o agendamento certo.
-- ---------------------------------------------------------------------
ALTER TABLE public.message_jobs
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS appointment_id uuid,
  ADD COLUMN IF NOT EXISTS agenda_reminder_rule_id uuid,
  ADD COLUMN IF NOT EXISTS funnel_followup_step_id uuid;

CREATE INDEX IF NOT EXISTS message_jobs_provider_message_id_idx
  ON public.message_jobs (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

COMMENT ON COLUMN public.message_jobs.provider_message_id IS
  'WAMID (id da mensagem na Meta) devolvido no envio — usado pra casar a resposta de um botão de confirmação de volta com este job.';
COMMENT ON COLUMN public.message_jobs.appointment_id IS
  'Agendamento de origem, quando este job foi criado por uma regra de lembrete/confirmação da Agenda.';
COMMENT ON COLUMN public.message_jobs.agenda_reminder_rule_id IS
  'Regra de lembrete/confirmação de origem, quando aplicável.';
COMMENT ON COLUMN public.message_jobs.funnel_followup_step_id IS
  'Passo de follow-up de origem, quando este job foi criado por uma sequência de follow-up de funil.';

-- ---------------------------------------------------------------------
-- 1) Lembretes / Confirmações da Agenda
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agenda_reminder_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- 'reminder' = aviso informativo, texto livre, sem esperar resposta.
  -- 'confirmation' = manda um MODELO aprovado com botões; clicar em
  -- "Confirmar" muda o agendamento pra confirmed sozinho.
  kind text NOT NULL CHECK (kind IN ('reminder', 'confirmation')),
  -- Quanto tempo antes do horário do agendamento disparar (minutos).
  offset_minutes integer NOT NULL CHECK (offset_minutes >= 0),
  -- Só dispara pra agendamentos nesse(s) status — ex: não faz sentido
  -- lembrar um agendamento já cancelado.
  applies_to_statuses text[] NOT NULL DEFAULT ARRAY['scheduled', 'confirmed'],
  -- Usado quando kind = 'reminder': texto livre com variáveis
  -- {nome} {data} {hora} {servico} {profissional}.
  message_text text,
  -- Usado quando kind = 'confirmation': nome/idioma do modelo aprovado
  -- (precisa ter botões de resposta rápida configurados na Meta).
  template_name text,
  template_language text,
  -- Texto do botão que conta como confirmação (bate com o "id"/"title"
  -- do botão de resposta rápida clicado, vindo do webhook da Meta).
  confirm_button_text text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agenda_reminder_rules_reminder_needs_text
    CHECK (kind != 'reminder' OR message_text IS NOT NULL),
  CONSTRAINT agenda_reminder_rules_confirmation_needs_template
    CHECK (kind != 'confirmation' OR (template_name IS NOT NULL AND template_language IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS agenda_reminder_rules_barbershop_idx
  ON public.agenda_reminder_rules (barbershop_id) WHERE active = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agenda_reminder_rules TO authenticated;
GRANT ALL ON public.agenda_reminder_rules TO service_role;
ALTER TABLE public.agenda_reminder_rules ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'agenda_reminder_rules' AND policyname = 'members can view agenda reminder rules') THEN
    CREATE POLICY "members can view agenda reminder rules" ON public.agenda_reminder_rules FOR SELECT TO authenticated USING (is_barbershop_member(barbershop_id, auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'agenda_reminder_rules' AND policyname = 'members can insert agenda reminder rules') THEN
    CREATE POLICY "members can insert agenda reminder rules" ON public.agenda_reminder_rules FOR INSERT TO authenticated WITH CHECK (is_barbershop_member(barbershop_id, auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'agenda_reminder_rules' AND policyname = 'members can update agenda reminder rules') THEN
    CREATE POLICY "members can update agenda reminder rules" ON public.agenda_reminder_rules FOR UPDATE TO authenticated USING (is_barbershop_member(barbershop_id, auth.uid())) WITH CHECK (is_barbershop_member(barbershop_id, auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'agenda_reminder_rules' AND policyname = 'members can delete agenda reminder rules') THEN
    CREATE POLICY "members can delete agenda reminder rules" ON public.agenda_reminder_rules FOR DELETE TO authenticated USING (is_barbershop_member(barbershop_id, auth.uid()));
  END IF;
END $$;

DROP TRIGGER IF EXISTS agenda_reminder_rules_set_updated_at ON public.agenda_reminder_rules;
CREATE TRIGGER agenda_reminder_rules_set_updated_at BEFORE UPDATE ON public.agenda_reminder_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Um agendamento só recebe cada regra UMA vez — evita mandar o mesmo
-- lembrete duas vezes se o avaliador rodar de novo antes do job ser
-- processado.
CREATE TABLE IF NOT EXISTS public.agenda_reminder_sent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.agenda_reminder_rules(id) ON DELETE CASCADE,
  message_job_id uuid REFERENCES public.message_jobs(id) ON DELETE SET NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (appointment_id, rule_id)
);
GRANT SELECT, INSERT, DELETE ON public.agenda_reminder_sent_log TO authenticated;
GRANT ALL ON public.agenda_reminder_sent_log TO service_role;
ALTER TABLE public.agenda_reminder_sent_log ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'agenda_reminder_sent_log' AND policyname = 'members can view agenda reminder sent log') THEN
    CREATE POLICY "members can view agenda reminder sent log" ON public.agenda_reminder_sent_log FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_id AND is_barbershop_member(a.barbershop_id, auth.uid())));
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2) Follow-up por etapa de funil
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.funnel_followup_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  funnel_id uuid NOT NULL REFERENCES public.funnels(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (funnel_id, stage_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.funnel_followup_rules TO authenticated;
GRANT ALL ON public.funnel_followup_rules TO service_role;
ALTER TABLE public.funnel_followup_rules ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'funnel_followup_rules' AND policyname = 'members can view funnel followup rules') THEN
    CREATE POLICY "members can view funnel followup rules" ON public.funnel_followup_rules FOR SELECT TO authenticated USING (is_barbershop_member(barbershop_id, auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'funnel_followup_rules' AND policyname = 'members can insert funnel followup rules') THEN
    CREATE POLICY "members can insert funnel followup rules" ON public.funnel_followup_rules FOR INSERT TO authenticated WITH CHECK (is_barbershop_member(barbershop_id, auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'funnel_followup_rules' AND policyname = 'members can update funnel followup rules') THEN
    CREATE POLICY "members can update funnel followup rules" ON public.funnel_followup_rules FOR UPDATE TO authenticated USING (is_barbershop_member(barbershop_id, auth.uid())) WITH CHECK (is_barbershop_member(barbershop_id, auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'funnel_followup_rules' AND policyname = 'members can delete funnel followup rules') THEN
    CREATE POLICY "members can delete funnel followup rules" ON public.funnel_followup_rules FOR DELETE TO authenticated USING (is_barbershop_member(barbershop_id, auth.uid()));
  END IF;
END $$;
DROP TRIGGER IF EXISTS funnel_followup_rules_set_updated_at ON public.funnel_followup_rules;
CREATE TRIGGER funnel_followup_rules_set_updated_at BEFORE UPDATE ON public.funnel_followup_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Sequência de passos de UMA regra — dia 3 manda X, dia 7 manda Y...
CREATE TABLE IF NOT EXISTS public.funnel_followup_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.funnel_followup_rules(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  -- Tempo parado na etapa até disparar este passo.
  delay_minutes integer NOT NULL CHECK (delay_minutes >= 0),
  -- Mesmo formato usado pelas Respostas Rápidas (texto/imagem/vídeo/áudio).
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Por passo (não pra regra inteira): pula o envio se o cliente já
  -- mandou mensagem depois de entrar nessa etapa.
  skip_if_replied boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS funnel_followup_steps_rule_idx ON public.funnel_followup_steps (rule_id, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.funnel_followup_steps TO authenticated;
GRANT ALL ON public.funnel_followup_steps TO service_role;
ALTER TABLE public.funnel_followup_steps ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'funnel_followup_steps' AND policyname = 'members can manage funnel followup steps') THEN
    CREATE POLICY "members can manage funnel followup steps" ON public.funnel_followup_steps FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.funnel_followup_rules r WHERE r.id = rule_id AND is_barbershop_member(r.barbershop_id, auth.uid())))
      WITH CHECK (EXISTS (SELECT 1 FROM public.funnel_followup_rules r WHERE r.id = rule_id AND is_barbershop_member(r.barbershop_id, auth.uid())));
  END IF;
END $$;

-- Rastreia quais passos já dispararam pra qual card — evita repetir.
CREATE TABLE IF NOT EXISTS public.funnel_followup_sent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES public.funnel_cards(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES public.funnel_followup_steps(id) ON DELETE CASCADE,
  message_job_id uuid REFERENCES public.message_jobs(id) ON DELETE SET NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (card_id, step_id)
);
GRANT SELECT, INSERT, DELETE ON public.funnel_followup_sent_log TO authenticated;
GRANT ALL ON public.funnel_followup_sent_log TO service_role;
ALTER TABLE public.funnel_followup_sent_log ENABLE ROW LEVEL SECURITY;

-- Quando o card entrou na etapa ATUAL — a contagem de tempo de cada passo
-- de follow-up parte daqui. Atualizado toda vez que stage_id muda (ver
-- funnel-cards.ts), inclusive voltando pra uma etapa que já visitou antes
-- (reinicia a sequência do zero).
ALTER TABLE public.funnel_cards
  ADD COLUMN IF NOT EXISTS stage_entered_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.funnel_cards.stage_entered_at IS
  'Quando o card entrou na etapa (stage_id) atual — usado pra calcular o tempo parado ali, base do follow-up por etapa.';
