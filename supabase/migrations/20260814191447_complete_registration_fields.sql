-- Campos adicionais para cadastro mais completo, a pedido do Mariano
-- (comparando com apps profissionais como Trinks/AppBarber).

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS birth_date DATE,
  ADD COLUMN IF NOT EXISTS address TEXT;

ALTER TABLE professionals
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5,2);

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;
