-- Texto da mensagem de boas-vindas pos-compra tambem configuravel pelo
-- painel, nao mais fixo no codigo - pedido do Mariano. Suporta {nome}
-- como variavel, substituida pelo primeiro nome da barbearia na hora do
-- envio.
ALTER TABLE public.zaylo_settings
  ADD COLUMN welcome_message_template text NOT NULL DEFAULT
    'Fala, {nome}! 🎉 Sua assinatura do CRM Zaylo foi confirmada. Quando você estiver no computador, é só entrar em crm.zayloia.com/instalar que o passo a passo está todo lá, com vídeo incluído. Qualquer dúvida, é só chamar por aqui mesmo.';
