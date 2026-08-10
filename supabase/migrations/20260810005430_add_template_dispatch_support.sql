-- Suporte a disparo de modelo aprovado (template) da API oficial. A Cloud
-- API da Meta só permite texto livre para contatos DENTRO da janela de 24h
-- de conversa ativa — disparo em massa pra leads frios precisa
-- obrigatoriamente de um modelo pré-aprovado. Até aqui só existia disparo
-- de texto livre (rendered_body).

ALTER TABLE message_jobs
  ADD COLUMN IF NOT EXISTS template_name TEXT,
  ADD COLUMN IF NOT EXISTS template_language TEXT;

COMMENT ON COLUMN message_jobs.template_name IS
  'Nome do modelo aprovado a disparar (API oficial da Meta). Se preenchido, o worker manda o modelo em vez do texto livre em rendered_body.';
COMMENT ON COLUMN message_jobs.template_language IS
  'Código de idioma do modelo (ex: pt_BR), exigido pela API da Meta ao enviar.';
