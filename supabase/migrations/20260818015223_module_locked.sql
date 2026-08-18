-- Módulo "trancado" — visível na grade (pra dar contexto do que vem por
-- aí), mas com cadeado/opacidade reduzida e não clicável, até o admin
-- liberar.

ALTER TABLE public.training_modules
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;
