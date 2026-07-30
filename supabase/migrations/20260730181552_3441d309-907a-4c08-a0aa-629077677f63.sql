-- Etiquetas do WhatsApp sincronizadas pela extensão
CREATE TABLE public.wa_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  wa_label_id text NOT NULL,
  name text NOT NULL,
  color text,
  conversation_count integer NOT NULL DEFAULT 0,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (barbershop_id, wa_label_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_labels TO authenticated;
GRANT ALL ON public.wa_labels TO service_role;
ALTER TABLE public.wa_labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage wa_labels" ON public.wa_labels FOR ALL TO authenticated
  USING (public.is_barbershop_member(barbershop_id, auth.uid()))
  WITH CHECK (public.is_barbershop_member(barbershop_id, auth.uid()));
CREATE TRIGGER wa_labels_updated_at BEFORE UPDATE ON public.wa_labels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Contatos e grupos do WhatsApp sincronizados
CREATE TABLE public.wa_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  wa_id text NOT NULL,
  phone text,
  name text,
  is_group boolean NOT NULL DEFAULT false,
  label_ids text[] NOT NULL DEFAULT '{}',
  last_message_at timestamptz,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (barbershop_id, wa_id)
);
CREATE INDEX wa_contacts_shop_phone_idx ON public.wa_contacts (barbershop_id, phone);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_contacts TO authenticated;
GRANT ALL ON public.wa_contacts TO service_role;
ALTER TABLE public.wa_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage wa_contacts" ON public.wa_contacts FOR ALL TO authenticated
  USING (public.is_barbershop_member(barbershop_id, auth.uid()))
  WITH CHECK (public.is_barbershop_member(barbershop_id, auth.uid()));
CREATE TRIGGER wa_contacts_updated_at BEFORE UPDATE ON public.wa_contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Funis de vendas
CREATE TABLE public.funnels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  name text NOT NULL,
  mode text NOT NULL DEFAULT 'manual',
  source_label_id text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.funnels TO authenticated;
GRANT ALL ON public.funnels TO service_role;
ALTER TABLE public.funnels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage funnels" ON public.funnels FOR ALL TO authenticated
  USING (public.is_barbershop_member(barbershop_id, auth.uid()))
  WITH CHECK (public.is_barbershop_member(barbershop_id, auth.uid()));
CREATE TRIGGER funnels_updated_at BEFORE UPDATE ON public.funnels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Colunas (etapas) de cada funil
CREATE TABLE public.funnel_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  funnel_id uuid NOT NULL REFERENCES public.funnels(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX funnel_stages_funnel_idx ON public.funnel_stages (funnel_id, sort_order);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.funnel_stages TO authenticated;
GRANT ALL ON public.funnel_stages TO service_role;
ALTER TABLE public.funnel_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage funnel_stages" ON public.funnel_stages FOR ALL TO authenticated
  USING (public.is_barbershop_member(barbershop_id, auth.uid()))
  WITH CHECK (public.is_barbershop_member(barbershop_id, auth.uid()));
CREATE TRIGGER funnel_stages_updated_at BEFORE UPDATE ON public.funnel_stages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Cartões (leads) dentro das etapas
CREATE TABLE public.funnel_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  funnel_id uuid NOT NULL REFERENCES public.funnels(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL REFERENCES public.funnel_stages(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  wa_contact_id uuid REFERENCES public.wa_contacts(id) ON DELETE CASCADE,
  title text NOT NULL,
  phone text,
  value_cents integer,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX funnel_cards_stage_idx ON public.funnel_cards (stage_id, sort_order);
CREATE UNIQUE INDEX funnel_cards_unique_contact ON public.funnel_cards (funnel_id, wa_contact_id) WHERE wa_contact_id IS NOT NULL;
CREATE UNIQUE INDEX funnel_cards_unique_customer ON public.funnel_cards (funnel_id, customer_id) WHERE customer_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.funnel_cards TO authenticated;
GRANT ALL ON public.funnel_cards TO service_role;
ALTER TABLE public.funnel_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage funnel_cards" ON public.funnel_cards FOR ALL TO authenticated
  USING (public.is_barbershop_member(barbershop_id, auth.uid()))
  WITH CHECK (public.is_barbershop_member(barbershop_id, auth.uid()));
CREATE TRIGGER funnel_cards_updated_at BEFORE UPDATE ON public.funnel_cards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();