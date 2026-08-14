-- Agenda profissional: configurações de funcionamento, profissionais,
-- serviços, e vínculo desses dois na tabela de agendamentos já existente.

-- 1) Configurações por barbearia: horário de funcionamento (por dia da
-- semana) e duração do slot da agenda.
CREATE TABLE public.agenda_settings (
  barbershop_id uuid PRIMARY KEY REFERENCES public.barbershops(id) ON DELETE CASCADE,
  slot_duration_minutes integer NOT NULL DEFAULT 30,
  -- Um objeto por dia da semana (0=domingo .. 6=sábado), cada um com
  -- horário de abertura/fechamento e se está fechado nesse dia.
  -- Ex: {"0": {"closed": true}, "1": {"open": "09:00", "close": "19:00", "closed": false}, ...}
  business_hours jsonb NOT NULL DEFAULT '{
    "0": {"closed": true},
    "1": {"open": "09:00", "close": "19:00", "closed": false},
    "2": {"open": "09:00", "close": "19:00", "closed": false},
    "3": {"open": "09:00", "close": "19:00", "closed": false},
    "4": {"open": "09:00", "close": "19:00", "closed": false},
    "5": {"open": "09:00", "close": "19:00", "closed": false},
    "6": {"open": "09:00", "close": "13:00", "closed": false}
  }'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agenda_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage agenda_settings" ON public.agenda_settings FOR ALL TO authenticated
  USING (public.is_barbershop_member(barbershop_id, auth.uid()))
  WITH CHECK (public.is_barbershop_member(barbershop_id, auth.uid()));
CREATE TRIGGER agenda_settings_updated_at BEFORE UPDATE ON public.agenda_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) Profissionais (barbeiros/prestadores) que aparecem como colunas na
-- agenda.
CREATE TABLE public.professionals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  color text NOT NULL DEFAULT '#7399D7', -- cor de identificação na agenda
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_professionals_barbershop ON public.professionals (barbershop_id);
ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage professionals" ON public.professionals FOR ALL TO authenticated
  USING (public.is_barbershop_member(barbershop_id, auth.uid()))
  WITH CHECK (public.is_barbershop_member(barbershop_id, auth.uid()));
CREATE TRIGGER professionals_updated_at BEFORE UPDATE ON public.professionals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) Serviços (catálogo) — nome, duração padrão, preço opcional.
CREATE TABLE public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  name text NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30,
  price numeric(10,2),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_services_barbershop ON public.services (barbershop_id);
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage services" ON public.services FOR ALL TO authenticated
  USING (public.is_barbershop_member(barbershop_id, auth.uid()))
  WITH CHECK (public.is_barbershop_member(barbershop_id, auth.uid()));
CREATE TRIGGER services_updated_at BEFORE UPDATE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4) Vincula agendamentos a profissional e serviço (ambos opcionais, pra
-- não quebrar agendamentos já criados antes dessa mudança).
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS professional_id uuid REFERENCES public.professionals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_id uuid REFERENCES public.services(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_professional ON public.appointments (professional_id);
