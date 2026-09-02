-- O link de "Integração Zero" (hosted embedded signup da Meta) é uma URL
-- fixa que não carrega NENHUMA informação de qual barbearia está
-- conectando — limitação do próprio formato desse link da Meta, não é
-- possível contornar passando um "state" customizado como no fluxo via
-- SDK JS. Até agora, o webhook (account_update / PARTNER_APP_INSTALLED)
-- "chutava" a conexão direto pra conta admin — funcionava só enquanto
-- era só o Mariano testando, mas um cliente de verdade (Isaque Bihain)
-- acabou de cair nesse caminho e a conexão dele foi parar na conta
-- admin por engano.
--
-- Esta tabela guarda a conexão como PENDENTE (sem barbearia nenhuma
-- ainda) — um admin confere manualmente qual barbearia é (pelo nome/
-- telefone que a Meta devolve) e "reivindica" pra conta certa.

CREATE TABLE IF NOT EXISTS public.pending_meta_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  waba_id text NOT NULL,
  phone_number_id text NOT NULL,
  phone text,
  meta_access_token text NOT NULL,
  meta_business_id text,
  claimed_barbershop_id uuid REFERENCES public.barbershops(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (waba_id)
);

CREATE INDEX IF NOT EXISTS pending_meta_connections_unclaimed_idx
  ON public.pending_meta_connections (created_at) WHERE claimed_barbershop_id IS NULL;

-- Só admin (service_role, usado pelas rotas /admin) mexe aqui — não é
-- exposto pra barbearias comuns.
ALTER TABLE public.pending_meta_connections ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.pending_meta_connections TO service_role;

DROP TRIGGER IF EXISTS pending_meta_connections_set_updated_at ON public.pending_meta_connections;
CREATE TRIGGER pending_meta_connections_set_updated_at BEFORE UPDATE ON public.pending_meta_connections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
