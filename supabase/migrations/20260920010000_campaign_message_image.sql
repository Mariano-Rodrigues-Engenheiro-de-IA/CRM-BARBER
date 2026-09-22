-- Imagem da MENSAGEM em si (o que vai anexado no disparo), separada da
-- imagem de CAPA (só a miniatura mostrada no card do calendário) —
-- antes a capa era reaproveitada como imagem de mensagem por engano,
-- usuário pediu pra separar.
ALTER TABLE public.campaign_catalog ADD COLUMN message_image_url text;
