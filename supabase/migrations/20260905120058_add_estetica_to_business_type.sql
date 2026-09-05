-- A trava original só permitia 'barbearia' e 'odontologia' — mesmo
-- padrão de esquecimento já visto em agenda_reminder_rules: código já
-- aceitava 'estetica' (admin, terminologia, telas novas), mas o banco
-- ainda barrava na cara. Substitui pela lista completa.
ALTER TABLE public.barbershops
  DROP CONSTRAINT IF EXISTS barbershops_business_type_check;

ALTER TABLE public.barbershops
  ADD CONSTRAINT barbershops_business_type_check
  CHECK (business_type IN ('barbearia', 'odontologia', 'estetica'));
