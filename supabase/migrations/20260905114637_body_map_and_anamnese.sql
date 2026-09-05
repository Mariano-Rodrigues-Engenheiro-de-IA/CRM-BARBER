-- Mapa corporal (clínica de estética) e Ficha de anamnese — mesma ideia
-- do odontograma/histórico odontológico, adaptada pro nicho de
-- estética. Padrão de tabela e índice igual ao dental_* já existente,
-- pra manter consistência.

CREATE TABLE IF NOT EXISTS public.body_map_markings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  view text NOT NULL CHECK (view IN ('front', 'back')),
  region text NOT NULL,
  procedure text NOT NULL,
  notes text,
  done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS body_map_markings_customer_idx ON public.body_map_markings (customer_id);
CREATE INDEX IF NOT EXISTS body_map_markings_barbershop_idx ON public.body_map_markings (barbershop_id);
ALTER TABLE public.body_map_markings ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.body_map_markings TO service_role;
CREATE TRIGGER body_map_markings_set_updated_at
  BEFORE UPDATE ON public.body_map_markings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Ficha de anamnese: um registro por paciente (vai sendo atualizado, não
-- é histórico de versões) — mesmo padrão de patient_notes (customers.notes),
-- só que com campos estruturados em vez de texto livre puro, porque
-- anamnese tem uma lista padronizada de perguntas que toda clínica de
-- estética faz (achado em pesquisa: condições de saúde, medicamentos,
-- alergias, gestação, tipo de pele, histórico de procedimentos).
CREATE TABLE IF NOT EXISTS public.anamnese_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL UNIQUE REFERENCES public.customers(id) ON DELETE CASCADE,
  health_conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  medications text,
  allergies jsonb NOT NULL DEFAULT '[]'::jsonb,
  allergies_other text,
  is_pregnant boolean,
  is_breastfeeding boolean,
  skin_type integer CHECK (skin_type BETWEEN 1 AND 6),
  keloid_tendency boolean,
  procedure_history text,
  notes text,
  filled_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS anamnese_forms_barbershop_idx ON public.anamnese_forms (barbershop_id);
ALTER TABLE public.anamnese_forms ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.anamnese_forms TO service_role;
CREATE TRIGGER anamnese_forms_set_updated_at
  BEFORE UPDATE ON public.anamnese_forms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
