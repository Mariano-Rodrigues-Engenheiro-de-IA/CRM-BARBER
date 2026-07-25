ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS waba_id text,
  ADD COLUMN IF NOT EXISTS phone_number_id text,
  ADD COLUMN IF NOT EXISTS meta_access_token text,
  ADD COLUMN IF NOT EXISTS meta_business_id text,
  ADD COLUMN IF NOT EXISTS is_coexistence boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.whatsapp_instances.waba_id IS 'Meta WhatsApp Business Account ID (provider = meta)';
COMMENT ON COLUMN public.whatsapp_instances.phone_number_id IS 'Meta phone number ID used to send messages';
COMMENT ON COLUMN public.whatsapp_instances.meta_access_token IS 'Long-lived access token (BSP/Meta) - server only';
COMMENT ON COLUMN public.whatsapp_instances.meta_business_id IS 'Meta Business Manager ID of the customer';
COMMENT ON COLUMN public.whatsapp_instances.is_coexistence IS 'True when the number was onboarded in Coexistence mode (already in use on WhatsApp Business app)';