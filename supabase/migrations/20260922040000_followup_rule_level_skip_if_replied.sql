-- "Pular se respondeu" vira uma regra do follow-up INTEIRO, não mais
-- configurável passo a passo (usuário achou confuso repetir a mesma
-- decisão em cada passo da sequência — é uma regra, não parte da
-- mensagem em si). A coluna antiga em funnel_followup_steps continua
-- existindo (não é mais lida por ninguém), evitando migration
-- destrutiva.
ALTER TABLE public.funnel_followup_rules
  ADD COLUMN skip_if_replied boolean NOT NULL DEFAULT true;
