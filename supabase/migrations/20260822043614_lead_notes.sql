-- Anotações por lead — múltiplas notas (texto e/ou mídia), não mais um
-- campo de texto único. Vinculada por wa_contact_id/telefone, igual ao
-- padrão já usado em customer_profiles/customer_deals, pra funcionar com
-- qualquer lead (esteja ou não dentro de um funil ainda).

CREATE TABLE public.lead_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  wa_contact_id uuid REFERENCES public.wa_contacts(id) ON DELETE SET NULL,
  phone text,
  body text,
  media_path text,
  media_url text,
  media_mime text,
  media_filename text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_lead_notes_shop ON public.lead_notes (barbershop_id);
CREATE INDEX idx_lead_notes_wa_contact ON public.lead_notes (wa_contact_id);
CREATE INDEX idx_lead_notes_phone ON public.lead_notes (barbershop_id, phone);
ALTER TABLE public.lead_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage lead_notes" ON public.lead_notes FOR ALL TO authenticated
  USING (public.is_barbershop_member(barbershop_id, auth.uid()))
  WITH CHECK (public.is_barbershop_member(barbershop_id, auth.uid()));
