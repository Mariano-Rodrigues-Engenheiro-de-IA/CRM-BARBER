-- Histórico de procedimentos por paciente — cada linha é "nessa visita,
-- nesses dentes, foi feito isso, custou tanto, está pago ou não". Um
-- lançamento cobre vários dentes de propósito (ex: "duas restaurações,
-- R$400" numa visita só) — por isso array, não um dente por linha (senão
-- o mesmo valor total contaria em dobro na soma do orçamento). Vinculado
-- opcionalmente a um agendamento de verdade (a "visita" que o Mariano
-- pediu pra vir da Agenda, sem duplicar nada) — nullable porque um
-- procedimento pode ser registrado retroativamente, sem um agendamento
-- correspondente no sistema (histórico antigo, por exemplo).
CREATE TABLE IF NOT EXISTS public.dental_procedures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  tooth_numbers integer[] NOT NULL DEFAULT '{}',
  procedure_type text NOT NULL,
  price_cents integer NOT NULL DEFAULT 0,
  paid boolean NOT NULL DEFAULT false,
  notes text,
  performed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dental_procedures_customer_idx ON public.dental_procedures (customer_id);
CREATE INDEX IF NOT EXISTS dental_procedures_barbershop_idx ON public.dental_procedures (barbershop_id);

ALTER TABLE public.dental_procedures ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.dental_procedures TO service_role;

CREATE TRIGGER dental_procedures_set_updated_at
  BEFORE UPDATE ON public.dental_procedures
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
