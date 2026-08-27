-- Link de agendamento público: opção de não mostrar profissionais pro
-- cliente e deixar o sistema escolher automaticamente, com 3 critérios de
-- distribuição possíveis.
ALTER TABLE public.agenda_settings ADD COLUMN hide_professional_selection boolean NOT NULL DEFAULT false;
ALTER TABLE public.agenda_settings ADD COLUMN distribution_mode text NOT NULL DEFAULT 'random';
ALTER TABLE public.agenda_settings ADD CONSTRAINT agenda_settings_distribution_mode_check
  CHECK (distribution_mode IN ('random', 'availability', 'priority'));
