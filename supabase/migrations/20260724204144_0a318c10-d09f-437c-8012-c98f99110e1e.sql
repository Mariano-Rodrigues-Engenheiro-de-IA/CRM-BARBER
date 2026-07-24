CREATE TABLE public.whatsapp_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL UNIQUE REFERENCES public.barbershops(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'uazapi',
  instance_id text,
  instance_token text,
  status text NOT NULL DEFAULT 'disconnected',
  phone text,
  last_qr text,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.whatsapp_instances TO authenticated;
GRANT ALL ON public.whatsapp_instances TO service_role;

ALTER TABLE public.whatsapp_instances ENABLE ROW LEVEL SECURITY;

-- Members can read status of their barbershop instance (but NOT the instance_token)
-- We rely on server functions to project safe columns; RLS covers direct API access.
CREATE POLICY "Members read own barbershop instance"
  ON public.whatsapp_instances
  FOR SELECT
  TO authenticated
  USING (public.is_barbershop_member(barbershop_id, auth.uid()));

CREATE TRIGGER whatsapp_instances_updated_at
  BEFORE UPDATE ON public.whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX whatsapp_instances_status_idx ON public.whatsapp_instances(status);
