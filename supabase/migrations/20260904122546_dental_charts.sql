-- Um odontograma por cliente (paciente), só usado por contas com
-- business_type = 'odontologia'. Guarda o payload inteiro que a
-- biblioteca react-advanced-odontogram exporta (getStatusChart()) — não
-- tenta modelar dente por dente nas nossas próprias colunas, a
-- biblioteca já define o formato e evolui as próprias migrações de
-- versão internamente.
CREATE TABLE IF NOT EXISTS public.dental_charts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  chart_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id)
);

CREATE INDEX IF NOT EXISTS dental_charts_barbershop_idx ON public.dental_charts (barbershop_id);

ALTER TABLE public.dental_charts ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.dental_charts TO service_role;

CREATE TRIGGER dental_charts_set_updated_at
  BEFORE UPDATE ON public.dental_charts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
