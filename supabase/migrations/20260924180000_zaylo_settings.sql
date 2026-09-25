-- Tabela pequena, de linha unica, pra guardar configuracoes gerais da
-- Zaylo (nao de uma barbearia especifica). Primeiro uso: qual barbearia
-- serve de "numero emissor" pra mensagens administrativas (boas-vindas
-- pos-compra, etc) - antes ficava fixo direto no codigo, pedido do
-- Mariano pra poder trocar pelo painel sem precisar de deploy.
CREATE TABLE public.zaylo_settings (
  id boolean PRIMARY KEY DEFAULT true CONSTRAINT single_row CHECK (id = true),
  sender_barbershop_id uuid REFERENCES public.barbershops(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.zaylo_settings (id, sender_barbershop_id)
VALUES (true, '3d9dc380-9341-4d4d-8874-e32e2643ae36');

ALTER TABLE public.zaylo_settings ENABLE ROW LEVEL SECURITY;
