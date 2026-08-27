-- Lista de prioridade dos profissionais (usada só como critério de
-- desempate na distribuição "Prioridade + disponibilidade"), independente
-- da ordem geral de exibição em Configurações → Profissionais.
ALTER TABLE public.agenda_settings ADD COLUMN priority_order uuid[] NOT NULL DEFAULT '{}';
