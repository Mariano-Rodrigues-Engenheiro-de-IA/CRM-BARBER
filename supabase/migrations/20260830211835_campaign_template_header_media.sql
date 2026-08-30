-- Causa raiz encontrada dos disparos com modelo aprovado falhando: quando
-- o modelo tem cabeçalho de imagem, a Meta EXIGE que a imagem seja enviada
-- de novo a cada disparo (não fica "gravada" no modelo aprovado) — e o
-- sistema não tinha nenhum jeito de guardar/mandar essa imagem.
--
-- template_header_media_path: caminho no bucket privado quick-reply-media
-- (mesmo bucket já usado pelas Respostas Rápidas) — uma URL assinada é
-- gerada na hora do disparo (não fica salva pronta, pra não expirar).

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS template_header_media_path text;

ALTER TABLE public.message_jobs
  ADD COLUMN IF NOT EXISTS template_header_media_path text;

COMMENT ON COLUMN public.campaigns.template_header_media_path IS
  'Caminho no bucket quick-reply-media da imagem de cabeçalho do modelo desta campanha (mesma imagem pra todos os contatos). NULL se o modelo não tiver cabeçalho de imagem.';
COMMENT ON COLUMN public.message_jobs.template_header_media_path IS
  'Cópia de campaigns.template_header_media_path no momento da criação do job — permite o worker de disparo gerar a URL assinada sem precisar consultar a campanha de novo.';
