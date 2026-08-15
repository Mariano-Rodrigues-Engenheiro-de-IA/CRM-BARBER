ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS is_subscriber boolean NOT NULL DEFAULT false;
UPDATE public.customers SET is_subscriber = true WHERE archived_at IS NULL;