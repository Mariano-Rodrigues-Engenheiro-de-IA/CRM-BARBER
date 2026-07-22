
CREATE TABLE public.activation_codes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  label text,
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '7 days'),
  used_at timestamp with time zone,
  used_token_id uuid REFERENCES public.extension_tokens(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.activation_codes TO service_role;

ALTER TABLE public.activation_codes ENABLE ROW LEVEL SECURITY;

-- No authenticated/anon policies: activation codes are only consumed by
-- the public extension endpoint using supabaseAdmin (service_role bypasses RLS).
-- Manual generation is done via SQL by the product owner.

CREATE INDEX activation_codes_code_idx ON public.activation_codes(code);
CREATE INDEX activation_codes_barbershop_idx ON public.activation_codes(barbershop_id);
