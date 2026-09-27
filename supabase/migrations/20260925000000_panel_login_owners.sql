-- Login e senha no painel, liberado por barbearia (rollout gradual).
--
-- login_required: quando true, o painel dessa barbearia exige cadastro/login
-- (e-mail + senha, via Supabase Auth) antes de mostrar qualquer aba. Padrao
-- false: todo mundo continua entrando como sempre ate ser marcado.
ALTER TABLE public.barbershops
  ADD COLUMN IF NOT EXISTS login_required boolean NOT NULL DEFAULT false;

-- Liga um usuario de login (auth.users) a UMA barbearia. O primeiro login
-- feito a partir de um painel ja autenticado pela extensao (que prova o
-- controle do WhatsApp) "reivindica" a barbearia; depois disso so esse
-- usuario entra. UNIQUE em barbershop_id = um dono por barbearia por enquanto.
CREATE TABLE IF NOT EXISTS public.barbershop_owners (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  barbershop_id uuid NOT NULL UNIQUE REFERENCES public.barbershops(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Sem policies: so o servidor (service role) le e escreve nessa tabela.
ALTER TABLE public.barbershop_owners ENABLE ROW LEVEL SECURITY;
