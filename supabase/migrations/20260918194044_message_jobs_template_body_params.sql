-- Disparo em massa via modelo aprovado (planilha, assinantes, funis)
-- não preenchia a variável {{1}} do corpo do template com o nome do
-- contato — o modelo ia "puro". A camada que fala com a Meta já
-- suporta isso (body_params), só faltava conectar na criação dos jobs.

ALTER TABLE public.message_jobs
  ADD COLUMN template_body_params text[];
