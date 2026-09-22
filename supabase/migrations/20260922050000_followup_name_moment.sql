-- Nome do follow-up (usuário identifica cada um) e "moment" — o botão
-- exato que o usuário escolheu na tela ("entered" / "left_stage" /
-- "time_in_stage"). Precisa ser separado de trigger_type porque
-- "entered" e "time_in_stage" usam o MESMO trigger_type internamente
-- (ambos contam a partir da entrada na etapa) — moment é só pra
-- reabrir a tela e saber qual dos 3 botões estava marcado, e pra
-- limitar a 1 mensagem só quando for "entered" ou "left_stage".
ALTER TABLE public.funnel_followup_rules
  ADD COLUMN name text,
  ADD COLUMN moment text NOT NULL DEFAULT 'time_in_stage'
    CHECK (moment IN ('entered', 'left_stage', 'time_in_stage'));

-- Preenche os follow-ups já existentes com um moment coerente, a
-- partir do trigger_type e do tempo do (único) passo que já tinham.
UPDATE public.funnel_followup_rules r
SET moment = CASE
  WHEN r.trigger_type = 'left_stage' THEN 'left_stage'
  WHEN EXISTS (
    SELECT 1 FROM public.funnel_followup_steps s
    WHERE s.rule_id = r.id AND s.delay_minutes = 0
  ) AND (SELECT count(*) FROM public.funnel_followup_steps s WHERE s.rule_id = r.id) = 1
    THEN 'entered'
  ELSE 'time_in_stage'
END;
