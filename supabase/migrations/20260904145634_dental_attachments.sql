-- Anexos do prontuário (radiografia, ficha antiga, qualquer documento do
-- paciente). Bucket PRIVADO de propósito — é dado sensível de saúde, não
-- é o mesmo caso de logo de treinamento (que é público sem problema).
-- Acesso só via URL assinada, gerada na hora pelo backend.
INSERT INTO storage.buckets (id, name, public)
VALUES ('dental-attachments', 'dental-attachments', false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.dental_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL DEFAULT 0,
  uploaded_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dental_attachments_customer_idx ON public.dental_attachments (customer_id);
CREATE INDEX IF NOT EXISTS dental_attachments_barbershop_idx ON public.dental_attachments (barbershop_id);

ALTER TABLE public.dental_attachments ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.dental_attachments TO service_role;
