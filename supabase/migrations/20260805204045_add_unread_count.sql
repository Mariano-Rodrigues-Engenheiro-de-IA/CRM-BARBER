ALTER TABLE public.wa_contacts ADD COLUMN IF NOT EXISTS unread_count integer NOT NULL DEFAULT 0;
