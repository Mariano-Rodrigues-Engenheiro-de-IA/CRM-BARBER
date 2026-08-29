-- Registro de toda chamada recebida no webhook do WhatsApp/Meta (GET de
-- verificação e POST de eventos), pra dar visibilidade real de dentro do
-- CRM sobre o que a Meta está mandando (ou não mandando) — sem precisar
-- caçar em log de servidor.
CREATE TABLE public.webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'meta_whatsapp',
  method text NOT NULL,
  -- 'verify' (GET de handshake), 'event' (POST com payload), 'rejected'
  -- (assinatura inválida ou token de verificação errado)
  kind text NOT NULL,
  status_code integer NOT NULL,
  headers jsonb,
  body jsonb,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_webhook_logs_created ON public.webhook_logs (created_at DESC);
CREATE INDEX idx_webhook_logs_source ON public.webhook_logs (source, created_at DESC);
-- Sem RLS de "membro da barbearia" — isso é visibilidade de plataforma,
-- só acessível pela tela /admin (que já fica atrás da autenticação do
-- site). Sem policy nenhuma = só a service role (supabaseAdmin) lê/escreve.
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;
