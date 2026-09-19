-- Pausa a cada X contatos: depois de mandar pra N contatos, o disparo
-- pausa por um tempo configurável antes de continuar. Diferente do
-- ritmo (pace_seconds_min/max, aleatório entre cada mensagem), essa é
-- uma pausa maior e periódica, baseada em contagem de contatos.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS pause_every_contacts integer,
  ADD COLUMN IF NOT EXISTS pause_seconds integer;
