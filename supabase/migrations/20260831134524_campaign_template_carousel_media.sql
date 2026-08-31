-- Mesma causa raiz do cabeçalho de imagem simples (migração
-- 20260830211835), só que pro modelo de CARROSSEL: a Meta exige uma
-- imagem por CARTÃO em todo envio (não fica gravada no modelo aprovado)
-- — sem isso, o disparo falha mesmo com o modelo aprovado.
--
-- template_carousel_media_paths: um array de caminhos no bucket privado
-- quick-reply-media (mesmo bucket já usado por Respostas Rápidas e pelo
-- cabeçalho de imagem simples), na MESMA ORDEM dos cartões do modelo.
-- URLs assinadas são geradas na hora do disparo (não ficam salvas
-- prontas, pra não expirar).

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS template_carousel_media_paths text[];

ALTER TABLE public.message_jobs
  ADD COLUMN IF NOT EXISTS template_carousel_media_paths text[];

COMMENT ON COLUMN public.campaigns.template_carousel_media_paths IS
  'Caminhos no bucket quick-reply-media das imagens de cada cartão do carrossel desta campanha, na ordem dos cartões. NULL se o modelo não for carrossel.';
COMMENT ON COLUMN public.message_jobs.template_carousel_media_paths IS
  'Cópia de campaigns.template_carousel_media_paths no momento da criação do job.';
