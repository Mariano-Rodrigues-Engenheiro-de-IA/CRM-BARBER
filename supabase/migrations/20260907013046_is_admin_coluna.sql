-- Substitui o mecanismo antigo (variável de ambiente ADMIN_BARBERSHOP_ID,
-- editada manualmente no Lovable) por uma coluna de verdade — o Mariano
-- pediu um botão no próprio painel pra não precisar mais mexer em
-- variável de ambiente toda vez que muda quem é admin.
ALTER TABLE public.barbershops ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;
