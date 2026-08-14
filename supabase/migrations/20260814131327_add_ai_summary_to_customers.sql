-- Resumo da IA, separado da anotação manual do vendedor — a IA (projeto
-- IA-BARBER-AGENDA) escreve aqui automaticamente durante a conversa,
-- sincronizando o mesmo resumo persistente que já mantém do lado dela.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS ai_summary TEXT,
  ADD COLUMN IF NOT EXISTS ai_summary_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN customers.ai_summary IS
  'Resumo da conversa gerado pela IA (sincronizado do IA-BARBER-AGENDA) — separado da anotação manual do vendedor.';
