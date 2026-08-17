-- Leads do formulário "Agendar demonstração" do Agente de IA — aparecem
-- na aba "Clientes interessados" do painel admin unificado.

CREATE TABLE public.ai_demo_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid REFERENCES public.barbershops(id) ON DELETE SET NULL,
  name text NOT NULL,
  phone text NOT NULL,
  segment text,
  revenue_range text,
  goal text, -- 'vendas' | 'agendamento' | 'ambos'
  status text NOT NULL DEFAULT 'novo', -- 'novo' | 'contatado' | 'convertido' | 'descartado'
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_demo_leads_created ON public.ai_demo_leads (created_at DESC);
ALTER TABLE public.ai_demo_leads ENABLE ROW LEVEL SECURITY;
-- Sem policy de leitura para 'authenticated' — só o admin acessa (via
-- service_role no backend), é dado comercial sensível (telefone/faturamento).
