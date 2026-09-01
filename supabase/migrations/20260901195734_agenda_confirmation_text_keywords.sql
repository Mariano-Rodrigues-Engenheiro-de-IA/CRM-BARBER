-- Confirmação passa a aceitar também resposta DIGITADA, não só clique no
-- botão do modelo — descoberto que o webhook da Meta já entrega o texto
-- completo de toda mensagem recebida (não só o clique de botão), então dá
-- pra aproveitar isso. As palavras que contam como confirmação são
-- configuráveis por regra (com uma lista padrão sensata).

ALTER TABLE public.agenda_reminder_rules
  ADD COLUMN IF NOT EXISTS confirm_keywords text[] NOT NULL
    DEFAULT ARRAY['sim', 'ok', 'okay', 'certo', 'confirmo', 'confirmado', 'beleza', 'blz', 'ta bom', 'tá bom'];

COMMENT ON COLUMN public.agenda_reminder_rules.confirm_keywords IS
  'Palavras/frases que, se aparecerem numa resposta digitada do cliente (sem diferenciar maiúsculas/acentos), contam como confirmação — além do clique no botão do modelo.';
