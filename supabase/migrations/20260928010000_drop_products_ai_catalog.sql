-- Remove de vez o catalogo de IA dos produtos (tabela de precos por faixa,
-- formula por m2, roteiro de atendimento, palavras-chave, escalar pra equipe).
-- Produto agora e simples: nome, valor, categoria, descricao, ativo.
--
-- ATENCAO: sem volta. Rode DEPOIS de publicar o codigo novo (o codigo antigo
-- ainda le essas colunas). Os indices GIN e a FK de produto_alternativo_sugerido
-- caem junto com as colunas.
ALTER TABLE public.products
  DROP COLUMN IF EXISTS palavras_chave_positivas,
  DROP COLUMN IF EXISTS palavras_chave_negativas,
  DROP COLUMN IF EXISTS produto_alternativo_sugerido,
  DROP COLUMN IF EXISTS tipo_precificacao,
  DROP COLUMN IF EXISTS tabela_precos,
  DROP COLUMN IF EXISTS formula_calculo,
  DROP COLUMN IF EXISTS variaveis_obrigatorias,
  DROP COLUMN IF EXISTS roteiro_atendimento,
  DROP COLUMN IF EXISTS pedido_minimo,
  DROP COLUMN IF EXISTS sempre_escalar_humano,
  DROP COLUMN IF EXISTS motivo_escalar,
  DROP COLUMN IF EXISTS link_catalogo,
  DROP COLUMN IF EXISTS mensagem_apresentacao,
  DROP COLUMN IF EXISTS observacoes_regras_especiais,
  DROP COLUMN IF EXISTS moeda;

DROP TYPE IF EXISTS public.product_pricing_type;
