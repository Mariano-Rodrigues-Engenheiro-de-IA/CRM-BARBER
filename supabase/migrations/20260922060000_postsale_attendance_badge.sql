-- Período que o contador de atendimentos (selinho na tesourinha) olha
-- pra trás — guardado junto da regra de Pós-venda, já que é a mesma
-- tela que configura isso. Padrão: 30 dias (último mês).
ALTER TABLE public.funnel_followup_rules
  ADD COLUMN badge_period_days integer NOT NULL DEFAULT 30;
