-- Upgrade das Respostas Rápidas, pedido pelo Mariano: categorização livre
-- (o usuário cria o nome da categoria, não é uma lista fixa do sistema),
-- atalho digitável na própria caixa de mensagem do WhatsApp, e favoritos.
--
-- category: texto livre; não existe tabela separada de categorias — a
-- lista de categorias que aparece nos filtros é simplesmente o conjunto de
-- valores distintos já usados. Mais simples de manter, e cobre o pedido
-- ("quem determina o tipo é o próprio usuário").
--
-- shortcut: a palavra que, digitada como "/palavra" na caixa de mensagem
-- do WhatsApp, abre/aciona essa resposta rápida direto, sem precisar abrir
-- o painel. Único por barbearia (comparação sem diferenciar maiúsculas)
-- pra não ter duas respostas disputando o mesmo atalho.
--
-- is_favorite: pra fixar as mais usadas no topo/num filtro próprio.

ALTER TABLE public.quick_replies
  ADD COLUMN category text,
  ADD COLUMN shortcut text,
  ADD COLUMN is_favorite boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX quick_replies_barbershop_shortcut_unique
  ON public.quick_replies (barbershop_id, lower(shortcut))
  WHERE shortcut IS NOT NULL;

COMMENT ON COLUMN public.quick_replies.category IS
  'Categoria livre, criada pelo próprio usuário (ex: Atendimento, Vendas, Pós-venda). Sem lista fixa — os filtros são gerados a partir dos valores já usados.';
COMMENT ON COLUMN public.quick_replies.shortcut IS
  'Palavra-atalho (sem espaços): digitar "/palavra" na caixa de mensagem do WhatsApp aciona esta resposta rápida direto. Único por barbearia, sem diferenciar maiúsculas/minúsculas.';
COMMENT ON COLUMN public.quick_replies.is_favorite IS
  'Marcada como favorita pelo usuário — aparece no filtro de favoritos.';
