-- Preserva os dados da instância UAZAPI separadamente dos campos genéricos
-- instance_id/instance_token (que hoje são sobrescritos toda vez que o
-- provider muda para "meta" ou "uazapi" — trocar de modo apagava os dados
-- do outro modo, fazendo o sistema achar que precisava criar uma instância
-- UAZAPI nova a cada troca, mesmo já existindo uma).

ALTER TABLE whatsapp_instances
  ADD COLUMN IF NOT EXISTS uazapi_instance_id TEXT,
  ADD COLUMN IF NOT EXISTS uazapi_instance_token TEXT;

COMMENT ON COLUMN whatsapp_instances.uazapi_instance_id IS
  'Instance ID da UAZAPI, preservado independente de qual provider (meta/uazapi) está ativo no momento — evita recriar a instância a cada troca de modo.';
COMMENT ON COLUMN whatsapp_instances.uazapi_instance_token IS
  'Token da instância UAZAPI, preservado independente de qual provider está ativo no momento.';