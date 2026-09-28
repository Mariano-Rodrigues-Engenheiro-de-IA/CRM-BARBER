-- Produtos simplificados: nome, valor, descricao, categoria (igual pra qualquer
-- tipo de negocio). So a descricao e nova; as colunas do catalogo antigo de IA
-- (tabela de precos, formula, roteiro...) continuam na tabela, sem uso na tela.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS description text;
