-- O resumo gerado pela IA (outro projeto, IA-BARBER-AGENDA) estava sendo
-- salvo na tabela "customers" — só que essa tabela é a de assinantes
-- (Assinaturas), não tem nada a ver com todo lead que passa pelo WhatsApp.
-- Resultado: o endpoint de ingestão (/api/public/ai/update-summary) achava
-- "cliente não encontrado" pra quase todo mundo e descartava o resumo em
-- silêncio — parecia um bug de tela ("carrega e some"), mas na real o dado
-- nunca chegava a ser salvo. Move pra customer_profiles, que já casa por
-- wa_contact_id/telefone com QUALQUER lead, não só assinante.
ALTER TABLE public.customer_profiles ADD COLUMN ai_summary text;
ALTER TABLE public.customer_profiles ADD COLUMN ai_summary_updated_at timestamptz;
