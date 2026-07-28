CREATE TABLE public.quick_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  title text NOT NULL,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX quick_replies_shop_idx ON public.quick_replies (barbershop_id, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quick_replies TO authenticated;
GRANT ALL ON public.quick_replies TO service_role;

ALTER TABLE public.quick_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can view quick replies" ON public.quick_replies FOR SELECT TO authenticated USING (is_barbershop_member(barbershop_id, auth.uid()));
CREATE POLICY "members can insert quick replies" ON public.quick_replies FOR INSERT TO authenticated WITH CHECK (is_barbershop_member(barbershop_id, auth.uid()));
CREATE POLICY "members can update quick replies" ON public.quick_replies FOR UPDATE TO authenticated USING (is_barbershop_member(barbershop_id, auth.uid())) WITH CHECK (is_barbershop_member(barbershop_id, auth.uid()));
CREATE POLICY "members can delete quick replies" ON public.quick_replies FOR DELETE TO authenticated USING (is_barbershop_member(barbershop_id, auth.uid()));

CREATE TRIGGER quick_replies_set_updated_at BEFORE UPDATE ON public.quick_replies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();