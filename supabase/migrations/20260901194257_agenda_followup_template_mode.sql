-- Correção de arquitetura: quando o número está conectado via API oficial
-- (Meta), TODO envio precisa ser feito por modelo aprovado — mensagem de
-- texto livre não é entregue de forma confiável fora da janela de 24h.
-- Só quando conectado via API não oficial (uazapi) é que texto livre e
-- respostas rápidas com mídia funcionam sem restrição.
--
-- Isso afeta os Lembretes (antes só aceitavam texto livre) e o Follow-up
-- (antes cada passo só aceitava texto livre) — os dois agora podem
-- também usar um modelo aprovado. A tela decide, na hora de criar,
-- qual opção mostrar pro usuário conforme o provedor conectado.

-- Lembrete (kind='reminder') passa a aceitar template_name/template_language
-- OU message_text — não mais só message_text. A constraint antiga exigia
-- message_text sempre; a nova exige pelo menos um dos dois.
ALTER TABLE public.agenda_reminder_rules
  DROP CONSTRAINT IF EXISTS agenda_reminder_rules_reminder_needs_text;

ALTER TABLE public.agenda_reminder_rules
  ADD CONSTRAINT agenda_reminder_rules_reminder_needs_content
    CHECK (kind != 'reminder' OR message_text IS NOT NULL OR template_name IS NOT NULL);

-- Cada passo do follow-up também pode usar um modelo aprovado, em vez de
-- (ou além de) texto livre nas actions.
ALTER TABLE public.funnel_followup_steps
  ADD COLUMN IF NOT EXISTS template_name text,
  ADD COLUMN IF NOT EXISTS template_language text;

COMMENT ON COLUMN public.funnel_followup_steps.template_name IS
  'Se preenchido, este passo manda um modelo aprovado em vez do texto livre em actions — obrigatório quando o número está conectado via Meta.';
