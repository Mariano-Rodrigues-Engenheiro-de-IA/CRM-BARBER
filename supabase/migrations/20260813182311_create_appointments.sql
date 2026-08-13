-- Agenda: agendamentos vinculados a um cliente (customers) da barbearia.
-- Mesmo padrão de RLS já usado em funnels/funnel_cards.

CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  title text NOT NULL,
  notes text,
  scheduled_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30,
  status text NOT NULL DEFAULT 'scheduled', -- scheduled | done | canceled
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_appointments_barbershop_date ON public.appointments (barbershop_id, scheduled_at);
CREATE INDEX idx_appointments_customer ON public.appointments (customer_id);

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage appointments" ON public.appointments FOR ALL TO authenticated
  USING (public.is_barbershop_member(barbershop_id, auth.uid()))
  WITH CHECK (public.is_barbershop_member(barbershop_id, auth.uid()));

CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
