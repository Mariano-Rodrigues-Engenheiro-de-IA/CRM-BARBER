-- As duas travas originais (reminder_needs_text, confirmation_needs_template)
-- exigiam texto/modelo sem considerar que qualquer um dos dois tipos pode
-- usar QUALQUER um dos dois formatos, dependendo do provedor conectado
-- (Meta exige modelo aprovado; fora dela, é texto livre). A trava de
-- confirmação bloqueava criar confirmação por texto livre (erro real visto
-- em produção); a de lembrete tinha o mesmo problema latente pra lembrete
-- por modelo (ainda não visto, mas bloquearia ao editar).
--
-- Substituídas por uma trava só, igual pros dois tipos: precisa ter modelo
-- (nome + idioma) OU mensagem de texto — nunca os dois vazios.
ALTER TABLE public.agenda_reminder_rules
  DROP CONSTRAINT IF EXISTS agenda_reminder_rules_reminder_needs_text;

ALTER TABLE public.agenda_reminder_rules
  DROP CONSTRAINT IF EXISTS agenda_reminder_rules_confirmation_needs_template;

ALTER TABLE public.agenda_reminder_rules
  ADD CONSTRAINT agenda_reminder_rules_needs_template_or_text
  CHECK ((template_name IS NOT NULL AND template_language IS NOT NULL) OR message_text IS NOT NULL);
