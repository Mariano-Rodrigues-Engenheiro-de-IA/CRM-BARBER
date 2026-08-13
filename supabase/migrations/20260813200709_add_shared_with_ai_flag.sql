-- Marca quando a instância UAZAPI em uso é COMPARTILHADA com a IA
-- (reaproveitada via a ponte), em vez de criada exclusivamente pelo CRM.
-- Usado para decidir o que "Desconectar" realmente faz: numa instância
-- compartilhada, desconectar não deve derrubar a sessão de WhatsApp de
-- verdade (isso afetaria a IA também) — só pausa o uso local do CRM.

ALTER TABLE whatsapp_instances
  ADD COLUMN IF NOT EXISTS shared_with_ai BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN whatsapp_instances.shared_with_ai IS
  'true quando essa instância foi reaproveitada da IA (via a ponte de unificação), não criada pelo CRM. Nesse caso, desconectar pelo CRM não derruba a sessão real de WhatsApp — só pausa o uso local.';
