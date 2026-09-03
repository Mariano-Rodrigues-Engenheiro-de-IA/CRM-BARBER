-- A conexão via Integração Zero (webhook account_update) esquecia de
-- pedir o campo platform_type da Meta — por isso nunca sabíamos se o
-- número ficou em modo Coexistência (dono continua usando o app do
-- celular normalmente) ou virou uma migração completa (app desconecta).
-- Isso já foi corrigido no código; esta coluna guarda o valor certo daqui
-- pra frente, pra sobreviver ao processo de reivindicar a conexão.

ALTER TABLE public.pending_meta_connections
  ADD COLUMN IF NOT EXISTS is_coexistence boolean NOT NULL DEFAULT false;
