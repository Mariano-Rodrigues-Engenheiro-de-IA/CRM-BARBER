-- Sem isso, quando o Cadastro Incorporado falhava no meio do caminho (ex:
-- WABA autorizada mas ainda sem número de telefone), a instância ficava
-- travada em "connecting" pra sempre, sem nenhum registro do motivo —
-- o /connect inicial marca "connecting" e nada mais atualizava a linha
-- se o passo seguinte desse erro.
ALTER TABLE public.whatsapp_instances ADD COLUMN last_error text;
