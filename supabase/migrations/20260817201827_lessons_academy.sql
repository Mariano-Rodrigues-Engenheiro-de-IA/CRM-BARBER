-- Área de Aulas ("academy"), estilo área de membros: banner grande com a
-- aula em destaque + as demais aulas enfileiradas abaixo. Conteúdo GLOBAL
-- (mesmo material de treinamento pra todos os clientes do CRM) — gerenciado
-- centralmente pelo admin, não por barbearia.

CREATE TABLE public.lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  youtube_url text NOT NULL,
  description text,
  -- Aula em destaque = vira o banner grande no topo. No máximo uma ativa
  -- por vez (garantido na aplicação, não em constraint).
  featured boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lessons_sort ON public.lessons (sort_order);
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;

-- Qualquer usuário autenticado do CRM pode LER as aulas (é conteúdo de
-- treinamento, não sensível). Só admin pode gerenciar (feito via
-- service_role no backend, sem policy de escrita para authenticated).
CREATE POLICY "authenticated read lessons" ON public.lessons FOR SELECT TO authenticated USING (true);

CREATE TRIGGER lessons_updated_at BEFORE UPDATE ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
