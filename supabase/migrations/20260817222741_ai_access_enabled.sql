-- Marca se a barbearia tem acesso liberado ao Agente de IA (vinculado
-- manualmente pelo admin do lado do IA-BARBER-AGENDA, que avisa o CRM
-- automaticamente via a ponte entre os dois projetos).

ALTER TABLE barbershops
  ADD COLUMN IF NOT EXISTS ai_access_enabled BOOLEAN NOT NULL DEFAULT false;
