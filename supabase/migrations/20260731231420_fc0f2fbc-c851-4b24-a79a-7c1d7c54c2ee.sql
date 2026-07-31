ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS message_actions jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.message_jobs
  ADD COLUMN IF NOT EXISTS message_actions jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_message_actions_is_array
  CHECK (jsonb_typeof(message_actions) = 'array') NOT VALID;

ALTER TABLE public.message_jobs
  ADD CONSTRAINT message_jobs_message_actions_is_array
  CHECK (jsonb_typeof(message_actions) = 'array') NOT VALID;