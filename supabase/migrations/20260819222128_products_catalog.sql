-- Catálogo de produtos — mesmo padrão de public.services, mas sem duração
-- (produto não ocupa agenda). Usado pelo cadastro em Configurações e
-- consumido pelo Ranking de vendas na hora de lançar uma venda de produto.
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text,
  price numeric(10,2),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_products_barbershop ON public.products (barbershop_id);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage products" ON public.products FOR ALL TO authenticated
  USING (public.is_barbershop_member(barbershop_id, auth.uid()))
  WITH CHECK (public.is_barbershop_member(barbershop_id, auth.uid()));
CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
