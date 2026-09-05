-- Quarto nicho: 'outros' — CRM genérico, sem Assinaturas/Ranking de
-- vendas (exclusivo de barbearia) nem Pacientes/ficha clínica
-- (exclusivo de odontologia/estética). Mesmo padrão de esquecimento já
-- corrigido duas vezes nesta trava — dessa vez direto pros 4 valores
-- de uma vez.
ALTER TABLE public.barbershops
  DROP CONSTRAINT IF EXISTS barbershops_business_type_check;

ALTER TABLE public.barbershops
  ADD CONSTRAINT barbershops_business_type_check
  CHECK (business_type IN ('barbearia', 'odontologia', 'estetica', 'outros'));
