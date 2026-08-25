-- Catálogo de produtos por barbearia/negócio — usado pelo Agente de IA
-- (IA-BARBER-AGENDA) para buscar o produto certo e calcular preço de
-- forma determinística, ao invés de depender do prompt "lembrar" tabelas
-- de preço em texto corrido (que já causou erro real de classificação
-- entre produtos parecidos — caso "placa" confundida com "banner").
--
-- barbershop_id É o "empresa_id" da especificação — reaproveita o mesmo
-- padrão de isolamento multi-tenant já usado em toda a base
-- (is_barbershop_member), não é um conceito novo.

CREATE TYPE public.product_pricing_type AS ENUM ('fixo', 'tabela_faixa', 'formula_area');

CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,

  nome_produto text NOT NULL,
  categoria text,

  -- Sinônimos que o cliente usaria para pedir esse produto.
  palavras_chave_positivas text[] NOT NULL DEFAULT '{}',
  -- Termos que, se aparecerem no pedido, indicam que NÃO é este produto
  -- mesmo que as positivas batam — é o campo que evita confundir produtos
  -- parecidos (ex.: banner madeira vs placa institucional).
  palavras_chave_negativas text[] NOT NULL DEFAULT '{}',
  -- Se uma negativa bater, para qual produto a busca deve sugerir em vez deste.
  produto_alternativo_sugerido uuid REFERENCES public.products(id) ON DELETE SET NULL,

  tipo_precificacao public.product_pricing_type NOT NULL DEFAULT 'fixo',
  -- Formato: { "faixas": [{ "quantidade_min", "quantidade_max", "variacoes": { "4x0": 80, ... } }] }
  tabela_precos jsonb,
  -- Formato: { "valor_m2", "pedido_minimo_valor", "sangra_cm", "adicionais": [...], "regra_solda": {...} }
  formula_calculo jsonb,

  -- O que o agente precisa coletar do cliente antes de calcular.
  variaveis_obrigatorias text[] NOT NULL DEFAULT '{}',
  pedido_minimo text,

  sempre_escalar_humano boolean NOT NULL DEFAULT false,
  motivo_escalar text,

  link_catalogo text,
  mensagem_apresentacao text,
  observacoes_regras_especiais text,

  moeda text NOT NULL DEFAULT 'BRL',
  ativo boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_products_barbershop ON public.products (barbershop_id) WHERE ativo;
-- Índice GIN para acelerar a checagem de palavras-chave (busca por
-- sobreposição de array), usado na Fase 2 (endpoint de busca).
CREATE INDEX idx_products_palavras_positivas ON public.products USING GIN (palavras_chave_positivas);
CREATE INDEX idx_products_palavras_negativas ON public.products USING GIN (palavras_chave_negativas);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Mesmo padrão de isolamento já usado em toda a base — nenhum conceito
-- novo de segurança, só reaproveitando is_barbershop_member().
CREATE POLICY "members manage products" ON public.products FOR ALL TO authenticated
  USING (public.is_barbershop_member(barbershop_id, auth.uid()))
  WITH CHECK (public.is_barbershop_member(barbershop_id, auth.uid()));

CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
