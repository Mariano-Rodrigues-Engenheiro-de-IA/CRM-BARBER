-- Mesma causa raiz já corrigida no Disparo (campanha) e confirmada agora
-- em teste real: modelo com cabeçalho de imagem precisa da imagem em
-- TODO envio — as telas de Lembrete/Confirmação e Follow-up ainda não
-- tinham como anexar essa imagem, por isso falhavam com
-- '(#132012) Parameter format does not match... expected IMAGE, received UNKNOWN'
-- ao escolher um modelo desse tipo.

ALTER TABLE public.agenda_reminder_rules
  ADD COLUMN IF NOT EXISTS template_header_media_path text;

ALTER TABLE public.funnel_followup_steps
  ADD COLUMN IF NOT EXISTS template_header_media_path text;

COMMENT ON COLUMN public.agenda_reminder_rules.template_header_media_path IS
  'Caminho no bucket quick-reply-media da imagem de cabeçalho, quando o modelo escolhido (reminder ou confirmation) tiver cabeçalho do tipo Imagem.';
COMMENT ON COLUMN public.funnel_followup_steps.template_header_media_path IS
  'Caminho no bucket quick-reply-media da imagem de cabeçalho, quando o modelo escolhido nesse passo tiver cabeçalho do tipo Imagem.';
