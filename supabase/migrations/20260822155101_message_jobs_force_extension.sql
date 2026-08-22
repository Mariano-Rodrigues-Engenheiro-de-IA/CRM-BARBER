-- Mensagens agendadas criadas pelo ícone da conversa (lead-schedule) devem
-- SEMPRE ser enviadas pela extensão do WhatsApp, independente de a
-- barbearia ter (ou não) uma conexão oficial "conectada" — porque essa
-- conexão pode estar com token inválido/expirado (como está acontecendo
-- agora, erro OAuthException), e nesse caso a extensão nunca assumia o
-- envio porque o sistema achava que o caminho oficial estava ok.
ALTER TABLE public.message_jobs ADD COLUMN force_extension boolean NOT NULL DEFAULT false;
