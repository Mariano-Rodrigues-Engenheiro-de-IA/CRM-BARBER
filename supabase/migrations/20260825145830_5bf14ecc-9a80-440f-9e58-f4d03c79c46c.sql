CREATE TYPE public.product_pricing_type AS ENUM ('fixo', 'tabela_faixa', 'formula_area');

ALTER TABLE public.products
  ADD COLUMN palavras_chave_positivas text[] NOT NULL DEFAULT '{}',
  ADD COLUMN palavras_chave_negativas text[] NOT NULL DEFAULT '{}',
  ADD COLUMN produto_alternativo_sugerido uuid REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN tipo_precificacao public.product_pricing_type NOT NULL DEFAULT 'fixo',
  ADD COLUMN tabela_precos jsonb,
  ADD COLUMN formula_calculo jsonb,
  ADD COLUMN variaveis_obrigatorias text[] NOT NULL DEFAULT '{}',
  ADD COLUMN pedido_minimo text,
  ADD COLUMN sempre_escalar_humano boolean NOT NULL DEFAULT false,
  ADD COLUMN motivo_escalar text,
  ADD COLUMN link_catalogo text,
  ADD COLUMN mensagem_apresentacao text,
  ADD COLUMN observacoes_regras_especiais text,
  ADD COLUMN moeda text NOT NULL DEFAULT 'BRL';

CREATE INDEX idx_products_palavras_positivas ON public.products USING GIN (palavras_chave_positivas);
CREATE INDEX idx_products_palavras_negativas ON public.products USING GIN (palavras_chave_negativas);

COMMENT ON COLUMN public.products.name IS 'Nome de exibição do produto (nome_produto da especificação)';
COMMENT ON COLUMN public.products.category IS 'Agrupamento macro (categoria da especificação)';
COMMENT ON COLUMN public.products.price IS 'Preço usado quando tipo_precificacao = fixo';
COMMENT ON COLUMN public.products.active IS 'Equivale a "ativo" da especificação';