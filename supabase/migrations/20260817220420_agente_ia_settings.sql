-- Configurações gerais (singleton) da página de vendas do Agente de IA —
-- hoje só o link do vídeo, editável pelo admin sem precisar mexer em código.

CREATE TABLE public.agente_ia_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id), -- garante uma única linha
  sales_video_url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.agente_ia_settings (id) VALUES (true);

ALTER TABLE public.agente_ia_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read agente_ia_settings" ON public.agente_ia_settings FOR SELECT TO authenticated USING (true);
