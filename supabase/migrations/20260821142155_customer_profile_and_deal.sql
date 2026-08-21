-- Perfil do cliente e Negociação/Valor — acessíveis tanto pelo WhatsApp
-- (ícones na conversa) quanto pelo CRM (dentro dos funis). Um registro por
-- contato, vinculado preferencialmente por wa_contact_id (contato real
-- sincronizado) com telefone como reserva, igual ao padrão já usado em
-- funnel_cards.

CREATE TABLE public.customer_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  wa_contact_id uuid REFERENCES public.wa_contacts(id) ON DELETE SET NULL,
  phone text,
  name text,
  email text,
  gender text,
  birth_date date,
  language text,
  country text,
  city text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_customer_profiles_shop ON public.customer_profiles (barbershop_id);
CREATE INDEX idx_customer_profiles_wa_contact ON public.customer_profiles (wa_contact_id);
CREATE INDEX idx_customer_profiles_phone ON public.customer_profiles (barbershop_id, phone);
ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage customer_profiles" ON public.customer_profiles FOR ALL TO authenticated
  USING (public.is_barbershop_member(barbershop_id, auth.uid()))
  WITH CHECK (public.is_barbershop_member(barbershop_id, auth.uid()));
CREATE TRIGGER customer_profiles_updated_at BEFORE UPDATE ON public.customer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.customer_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  wa_contact_id uuid REFERENCES public.wa_contacts(id) ON DELETE SET NULL,
  phone text,
  stage_label text,
  state text,
  lead_source text,
  entry_date date,
  exit_date date,
  value_cents integer,
  company text,
  role text,
  products_of_interest text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_customer_deals_shop ON public.customer_deals (barbershop_id);
CREATE INDEX idx_customer_deals_wa_contact ON public.customer_deals (wa_contact_id);
CREATE INDEX idx_customer_deals_phone ON public.customer_deals (barbershop_id, phone);
ALTER TABLE public.customer_deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage customer_deals" ON public.customer_deals FOR ALL TO authenticated
  USING (public.is_barbershop_member(barbershop_id, auth.uid()))
  WITH CHECK (public.is_barbershop_member(barbershop_id, auth.uid()));
CREATE TRIGGER customer_deals_updated_at BEFORE UPDATE ON public.customer_deals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
