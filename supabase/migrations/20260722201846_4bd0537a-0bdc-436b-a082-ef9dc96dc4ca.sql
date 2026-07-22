
-- Drop old activation-code flow
DROP TABLE IF EXISTS public.activation_codes CASCADE;

-- Add lead fields to barbershops
ALTER TABLE public.barbershops
  ADD COLUMN IF NOT EXISTS owner_name text,
  ADD COLUMN IF NOT EXISTS owner_email text,
  ADD COLUMN IF NOT EXISTS owner_phone text;

CREATE UNIQUE INDEX IF NOT EXISTS barbershops_owner_phone_unique
  ON public.barbershops (owner_phone)
  WHERE owner_phone IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS barbershops_owner_email_unique
  ON public.barbershops (lower(owner_email))
  WHERE owner_email IS NOT NULL;
