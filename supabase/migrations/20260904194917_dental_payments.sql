-- Separa "o que foi feito" de "o que foi pago" — pedido do Mariano
-- depois de perceber que os dois nem sempre andam juntos (paciente com
-- orçamento de R$10.000, mas só pagou R$4.000 até agora, sem esse valor
-- corresponder a um procedimento específico).
--
-- dental_procedures.paid virava "feito/pendente" (done) — deixa de ser
-- sobre dinheiro, passa a ser só sobre execução do procedimento.
ALTER TABLE public.dental_procedures RENAME COLUMN paid TO done;

-- Pagamentos: ficha própria, sem vínculo obrigatório com procedimento
-- nenhum. A pessoa lança o que entrou (valor, data, observação livre),
-- e a soma disso vira "total pago" do paciente, independente de quais
-- procedimentos isso cobre.
CREATE TABLE IF NOT EXISTS public.dental_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL DEFAULT 0,
  notes text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dental_payments_customer_idx ON public.dental_payments (customer_id);
CREATE INDEX IF NOT EXISTS dental_payments_barbershop_idx ON public.dental_payments (barbershop_id);

ALTER TABLE public.dental_payments ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.dental_payments TO service_role;

CREATE TRIGGER dental_payments_set_updated_at
  BEFORE UPDATE ON public.dental_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
