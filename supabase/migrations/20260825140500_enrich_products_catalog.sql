-- Enriquece a tabela public.products já existente (criada em
-- 20260819222128_products_catalog.sql para o cadastro simples usado pelo
-- Ranking de vendas: name, category, price) com os campos estruturados
-- propostos na especificação da Gráfica Gavi — catálogo de produtos fora
-- do prompt, usado pelo Agente de IA (IA-BARBER-AGENDA) para buscar o
-- produto certo e calcular preço de forma determinística, em vez de
-- depender do prompt "lembrar" tabelas de preço em texto corrido (que já
-- causou erro real de classificação entre produtos parecidos — caso
-- "placa" confundida com "banner").
--
-- IMPORTANTE: esta migration NÃO recria a tabela. A primeira tentativa
-- (removida) criava public.products do zero e colidia com a tabela já
-- existente (mesmo nome de tabela, índice, política e trigger) — teria
-- falhado com "relation already exists" ao aplicar.
--
-- Mapeamento com os campos já existentes (reaproveitados, não duplicados):
--   name     → nome_produto da especificação
--   category → categoria da especificação
--   price    → valor usado quando tipo_precificacao = 'fixo'
--   active   → ativo da especificação
--
-- barbershop_id já é o "empresa_id" da especificação — reaproveita o
-- mesmo padrão de isolamento multi-tenant já usado em toda a base
-- (is_barbershop_member), sem introduzir nenhum conceito novo de
-- segurança — a Parte 4 da especificação (isolamento entre empresas) já
-- vem resolvida de graça por isso.
--
-- Decisão confirmada com o Mariano: começar só com busca por
-- palavra-chave (sem camada semântica/embeddings por enquanto) — por
-- isso o campo texto_busca_semantico da especificação original foi
-- deixado de fora nessa fase, pode ser adicionado depois sem quebrar nada.

CREATE TYPE public.product_pricing_type AS ENUM ('fixo', 'tabela_faixa', 'formula_area');

ALTER TABLE public.products
  ADD COLUMN palavras_chave_positivas text[] NOT NULL DEFAULT '{}',
  -- Termos que, se aparecerem no pedido, indicam que NÃO é este produto
  -- mesmo que as positivas batam — evita confundir produtos parecidos
  -- (ex.: banner madeira vs placa institucional).
  ADD COLUMN palavras_chave_negativas text[] NOT NULL DEFAULT '{}',
  -- Se uma negativa bater, para qual produto a busca deve sugerir em vez deste.
  ADD COLUMN produto_alternativo_sugerido uuid REFERENCES public.products(id) ON DELETE SET NULL,

  ADD COLUMN tipo_precificacao public.product_pricing_type NOT NULL DEFAULT 'fixo',
  -- Formato: { "faixas": [{ "quantidade_min", "quantidade_max", "variacoes": { "4x0": 80, ... } }] }
  ADD COLUMN tabela_precos jsonb,
  -- Formato: { "valor_m2", "pedido_minimo_valor", "sangra_cm", "adicionais": [...], "regra_solda": {...} }
  ADD COLUMN formula_calculo jsonb,

  -- O que o agente precisa coletar do cliente antes de calcular.
  ADD COLUMN variaveis_obrigatorias text[] NOT NULL DEFAULT '{}',
  ADD COLUMN pedido_minimo text,

  ADD COLUMN sempre_escalar_humano boolean NOT NULL DEFAULT false,
  ADD COLUMN motivo_escalar text,

  ADD COLUMN link_catalogo text,
  ADD COLUMN mensagem_apresentacao text,
  ADD COLUMN observacoes_regras_especiais text,

  ADD COLUMN moeda text NOT NULL DEFAULT 'BRL';

-- Índices GIN para acelerar a checagem de palavras-chave (busca por
-- sobreposição de array), usados na Parte 2 (endpoint de busca).
CREATE INDEX idx_products_palavras_positivas ON public.products USING GIN (palavras_chave_positivas);
CREATE INDEX idx_products_palavras_negativas ON public.products USING GIN (palavras_chave_negativas);

COMMENT ON COLUMN public.products.name IS 'Nome de exibição do produto (nome_produto da especificação)';
COMMENT ON COLUMN public.products.category IS 'Agrupamento macro (categoria da especificação)';
COMMENT ON COLUMN public.products.price IS 'Preço usado quando tipo_precificacao = fixo';
COMMENT ON COLUMN public.products.active IS 'Equivale a "ativo" da especificação';
