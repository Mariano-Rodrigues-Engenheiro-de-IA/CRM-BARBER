-- Bloqueio de horário (folga, almoço, feriado, indisponibilidade) — pode
-- ser de um profissional específico ou da loja inteira (professional_id
-- nulo). Aparece na agenda como período indisponível, sem poder criar
-- agendamento ali.
CREATE TABLE public.time_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  professional_id uuid REFERENCES public.professionals(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_time_blocks_barbershop ON public.time_blocks (barbershop_id, starts_at);
CREATE INDEX idx_time_blocks_professional ON public.time_blocks (professional_id);
ALTER TABLE public.time_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage time_blocks" ON public.time_blocks FOR ALL TO authenticated
  USING (public.is_barbershop_member(barbershop_id, auth.uid()))
  WITH CHECK (public.is_barbershop_member(barbershop_id, auth.uid()));

-- Vínculo profissional <-> serviço (quais serviços cada profissional
-- realiza). Se um serviço não tiver NENHUM vínculo, é considerado
-- disponível para todos os profissionais (compatibilidade com o que já
-- existia antes dessa tabela).
CREATE TABLE public.professional_services (
  professional_id uuid NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  PRIMARY KEY (professional_id, service_id)
);

CREATE INDEX idx_prof_services_service ON public.professional_services (service_id);
ALTER TABLE public.professional_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage professional_services" ON public.professional_services FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.professionals p WHERE p.id = professional_id AND public.is_barbershop_member(p.barbershop_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.professionals p WHERE p.id = professional_id AND public.is_barbershop_member(p.barbershop_id, auth.uid())));
