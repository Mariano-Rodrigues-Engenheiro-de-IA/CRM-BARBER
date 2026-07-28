CREATE TABLE public.shop_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  stripe_subscription_id text NOT NULL UNIQUE,
  stripe_customer_id text NOT NULL,
  product_id text,
  price_id text,
  status text NOT NULL DEFAULT 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  environment text NOT NULL DEFAULT 'sandbox',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_shop_subscriptions_shop ON public.shop_subscriptions(barbershop_id);

GRANT SELECT ON public.shop_subscriptions TO authenticated;
GRANT ALL ON public.shop_subscriptions TO service_role;

ALTER TABLE public.shop_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can view their shop subscription"
  ON public.shop_subscriptions FOR SELECT TO authenticated
  USING (public.is_barbershop_member(barbershop_id, auth.uid()));

CREATE TRIGGER set_shop_subscriptions_updated_at
  BEFORE UPDATE ON public.shop_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();