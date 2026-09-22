-- Catálogo de campanhas sazonais (marketplace) — conteúdo GLOBAL,
-- curado pelo admin (mesmo padrão de lessons/modules), mostrado pra
-- todos os clientes no calendário da aba Campanhas.

CREATE TABLE public.campaign_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  -- Mês-alvo (1-12) para posicionar no calendário. Null = campanha
  -- "atemporal", disponível o ano todo (ex: aniversário do cliente).
  month integer CHECK (month IS NULL OR (month >= 1 AND month <= 12)),
  -- Tema/gancho da campanha, ex: "Novembro Azul", "Black Friday" — mostrado
  -- como selo/etiqueta no card.
  theme text,
  -- Resumo da ideia geral por trás da campanha (o "porquê"), mostrado
  -- antes da copy pronta.
  idea_summary text NOT NULL,
  -- Copy pronta, sugerida — o texto que o usuário vai usar/editar.
  suggested_copy text NOT NULL,
  cover_image_url text,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX campaign_catalog_month_idx ON public.campaign_catalog (month);
CREATE INDEX campaign_catalog_active_idx ON public.campaign_catalog (active);

-- Campanhas "adotadas" por cada barbearia (o marketplace virando ativo
-- próprio) — a parte de baixo da tela, o que o usuário efetivamente vai
-- usar pra disparar.
CREATE TABLE public.saved_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  -- De qual campanha do catálogo essa foi adotada — mantido mesmo após
  -- editar (só referência de origem, não trava o conteúdo).
  catalog_campaign_id uuid REFERENCES public.campaign_catalog(id) ON DELETE SET NULL,
  title text NOT NULL,
  body_text text NOT NULL,
  -- Caminho da imagem escolhida (própria do tenant, pode ter trocado a
  -- de exemplo do catálogo) — reaproveitada automaticamente no disparo,
  -- sem precisar re-anexar toda vez.
  image_path text,
  -- Só relevante pra API oficial: draft (não enviado), pending_approval,
  -- approved, rejected. Pra API não-oficial, fica sempre "approved"
  -- (equivalente a "pronta"), já que não passa por análise da Meta.
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected')),
  rejection_reason text,
  -- Nome do modelo criado na Meta (só quando status envolveu API
  -- oficial) — usado pra consultar o status atualizado direto na Meta,
  -- já que modelos não são espelhados numa tabela local (ver
  -- whatsapp.templates.ts).
  whatsapp_template_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX saved_campaigns_barbershop_idx ON public.saved_campaigns (barbershop_id);
