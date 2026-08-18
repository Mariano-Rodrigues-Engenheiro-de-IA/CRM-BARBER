-- Área de Treinamento organizada por módulos (estilo curso/área de
-- membros): cada módulo tem capa, título, descrição — e agrupa aulas.

CREATE TABLE public.training_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  cover_image_url text,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_training_modules_sort ON public.training_modules (sort_order);
ALTER TABLE public.training_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read training_modules" ON public.training_modules FOR SELECT TO authenticated USING (true);
CREATE TRIGGER training_modules_updated_at BEFORE UPDATE ON public.training_modules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Toda aula passa a pertencer a um módulo. Nullable por enquanto (aulas já
-- existentes ainda não categorizadas) — o admin organiza depois; o campo
-- pode virar NOT NULL futuramente quando tudo estiver categorizado.
ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS module_id uuid REFERENCES public.training_modules(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lessons_module ON public.lessons (module_id);

-- Bucket de Storage para as capas dos módulos (upload real pelo admin,
-- não link — diferente do banner/vídeo que são links fixos).
INSERT INTO storage.buckets (id, name, public)
VALUES ('training-covers', 'training-covers', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "public read training-covers" ON storage.objects FOR SELECT
  USING (bucket_id = 'training-covers');
CREATE POLICY "authenticated upload training-covers" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'training-covers');
CREATE POLICY "authenticated update training-covers" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'training-covers');
CREATE POLICY "authenticated delete training-covers" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'training-covers');
