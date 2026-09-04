-- Base do pivô multi-nicho: cada barbearia (nome genérico da tabela, mas
-- passa a representar "conta"/"negócio" de qualquer nicho) ganha um tipo.
-- Começa só com barbearia e odontologia — os outros nichos (estética
-- etc.) entram como novos valores aqui quando forem construídos, não
-- precisa de nada genérico agora.
ALTER TABLE public.barbershops
  ADD COLUMN IF NOT EXISTS business_type text NOT NULL DEFAULT 'barbearia'
  CHECK (business_type IN ('barbearia', 'odontologia'));
