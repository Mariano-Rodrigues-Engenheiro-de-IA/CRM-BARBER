-- Correção de rumo pedida pelo Mariano: categoria NÃO é mais um texto
-- livre repetido em cada resposta rápida. Agora é uma entidade própria —
-- criada antes (com nome e cor), e depois atribuída a cada resposta rápida
-- por seleção (não digitando de novo toda vez).
--
-- Escrito de forma defensiva (IF NOT EXISTS / IF EXISTS) porque a migração
-- anterior (20260830170748) pode ou não ter sido aplicada manualmente —
-- este script funciona corretamente nos dois casos.

ALTER TABLE public.quick_replies
  ADD COLUMN IF NOT EXISTS shortcut text,
  ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'quick_replies_barbershop_shortcut_unique'
  ) THEN
    CREATE UNIQUE INDEX quick_replies_barbershop_shortcut_unique
      ON public.quick_replies (barbershop_id, lower(shortcut))
      WHERE shortcut IS NOT NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.quick_reply_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- Cor em hex (#rrggbb), escolhida pelo usuário ao criar a categoria.
  color text NOT NULL DEFAULT '#3d5fa8',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS quick_reply_categories_barbershop_name_unique
  ON public.quick_reply_categories (barbershop_id, lower(name));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quick_reply_categories TO authenticated;
GRANT ALL ON public.quick_reply_categories TO service_role;

ALTER TABLE public.quick_reply_categories ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'quick_reply_categories' AND policyname = 'members can view quick reply categories') THEN
    CREATE POLICY "members can view quick reply categories" ON public.quick_reply_categories FOR SELECT TO authenticated USING (is_barbershop_member(barbershop_id, auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'quick_reply_categories' AND policyname = 'members can insert quick reply categories') THEN
    CREATE POLICY "members can insert quick reply categories" ON public.quick_reply_categories FOR INSERT TO authenticated WITH CHECK (is_barbershop_member(barbershop_id, auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'quick_reply_categories' AND policyname = 'members can update quick reply categories') THEN
    CREATE POLICY "members can update quick reply categories" ON public.quick_reply_categories FOR UPDATE TO authenticated USING (is_barbershop_member(barbershop_id, auth.uid())) WITH CHECK (is_barbershop_member(barbershop_id, auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'quick_reply_categories' AND policyname = 'members can delete quick reply categories') THEN
    CREATE POLICY "members can delete quick reply categories" ON public.quick_reply_categories FOR DELETE TO authenticated USING (is_barbershop_member(barbershop_id, auth.uid()));
  END IF;
END $$;

-- Cada resposta rápida pode pertencer a NO MÁXIMO uma categoria (escolhida
-- de uma lista, não mais digitada). Apagar a categoria solta a resposta
-- (fica "sem categoria"), em vez de apagar a resposta junto.
ALTER TABLE public.quick_replies
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.quick_reply_categories(id) ON DELETE SET NULL;

-- Substitui de vez a coluna antiga de texto livre, se ela existir.
ALTER TABLE public.quick_replies DROP COLUMN IF EXISTS category;

COMMENT ON TABLE public.quick_reply_categories IS
  'Categorias de respostas rápidas — criadas explicitamente pelo usuário (nome + cor), depois atribuídas às respostas por seleção.';
COMMENT ON COLUMN public.quick_reply_categories.color IS
  'Cor em hex (#rrggbb) escolhida pelo usuário, usada no chip/badge da categoria.';
COMMENT ON COLUMN public.quick_replies.category_id IS
  'Categoria desta resposta (quick_reply_categories.id), ou NULL se estiver sem categoria.';
