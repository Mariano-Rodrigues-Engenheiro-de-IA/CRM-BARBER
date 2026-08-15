ALTER TABLE public.agenda_settings
  ADD COLUMN IF NOT EXISTS online_booking_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_slug text;

UPDATE public.agenda_settings s
SET public_slug = COALESCE(
  s.public_slug,
  NULLIF(regexp_replace(lower(COALESCE(b.name, 'barbearia')), '[^a-z0-9]+', '-', 'g'), '') || '-' || substr(s.barbershop_id::text, 1, 6)
)
FROM public.barbershops b
WHERE b.id = s.barbershop_id AND s.public_slug IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS agenda_settings_public_slug_key ON public.agenda_settings (public_slug) WHERE public_slug IS NOT NULL;