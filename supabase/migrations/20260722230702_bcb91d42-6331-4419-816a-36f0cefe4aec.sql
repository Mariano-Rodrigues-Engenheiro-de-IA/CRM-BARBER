
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS spreadsheet_batch_id uuid,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS customers_batch_idx ON public.customers(barbershop_id, spreadsheet_batch_id);
CREATE INDEX IF NOT EXISTS customers_active_idx ON public.customers(barbershop_id) WHERE archived_at IS NULL;

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS message_variants text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS pace_seconds_min integer,
  ADD COLUMN IF NOT EXISTS pace_seconds_max integer;
