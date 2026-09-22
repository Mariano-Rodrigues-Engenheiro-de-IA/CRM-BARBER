-- Controle de "mês liberado" no calendário de campanhas — o admin
-- decide até qual mês está aberto pra ver/usar; os meses seguintes
-- aparecem com cadeado na tela do cliente. Linha única (singleton).
CREATE TABLE public.campaign_calendar_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true), -- garante 1 linha só
  unlocked_through_month integer NOT NULL DEFAULT 12 CHECK (unlocked_through_month >= 1 AND unlocked_through_month <= 12),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.campaign_calendar_config (id, unlocked_through_month) VALUES (true, 12)
ON CONFLICT (id) DO NOTHING;

-- Suporte a áudio nas campanhas (além de imagem) — mesmo padrão de
-- upload real de arquivo já usado pra capa.
ALTER TABLE public.campaign_catalog ADD COLUMN audio_url text;
ALTER TABLE public.saved_campaigns ADD COLUMN audio_path text;
