-- Roteiro de atendimento por produto — mudança de arquitetura pedida pelo
-- Mariano: em vez da IA decidir por conta própria como conduzir a conversa
-- depois de identificar o produto (só orientada por uma lista solta de
-- nomes em variaveis_obrigatorias), o CADASTRO do produto agora carrega o
-- roteiro exato: uma lista ORDENADA de perguntas, cada uma com o texto
-- exato que a IA deve usar. Reduz ainda mais a decisão livre da IA — ela
-- segue o roteiro, não inventa a pergunta nem a ordem.
--
-- Formato: [{ "campo": "largura_m", "pergunta": "Qual a largura, em metros?" }, ...]
-- "campo" é o nome da variável (mesmo conceito de variaveis_obrigatorias,
-- que continua existindo — roteiro_atendimento é o "como perguntar",
-- variaveis_obrigatorias continua sendo "o que é obrigatório ter antes de
-- calcular", útil como checagem mesmo se o roteiro não estiver preenchido).

ALTER TABLE public.products
  ADD COLUMN roteiro_atendimento jsonb;

COMMENT ON COLUMN public.products.roteiro_atendimento IS
  'Lista ordenada de perguntas [{"campo","pergunta"}] que a IA segue exatamente, na ordem, ao conduzir o atendimento deste produto. Se vazio/nulo, a IA usa variaveis_obrigatorias com liberdade de formular a pergunta.';
