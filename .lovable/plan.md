
# Replano — modelo WaSeller

## O que muda em relação ao plano anterior

O plano aprovado tinha um **CRM web completo** (login do dono, telas de cliente/tag/campanha, dashboard). No modelo WaSeller isso não existe: o dono da barbearia **nunca abre uma página web pra usar o produto**. Ele instala a extensão, abre o WhatsApp Web, e todo o CRM (lista de clientes, tags, campanhas, disparo) aparece **injetado dentro da tela do WhatsApp Web**.

O backend continua existindo — mas com finalidade diferente.

## Divisão nova de responsabilidades

**Backend (Supabase + endpoints públicos):**
- Guarda dados por tenant (clientes, tags, templates, campanhas, jobs de disparo, tokens).
- Valida licença (a mensalidade de R$97 continua existindo — sem isso não tem como cobrar).
- Expõe API que a extensão consome (ler clientes, criar campanha, buscar próximo job da fila, marcar job como enviado).
- Isolamento por tenant continua rigoroso (o token da extensão amarra tudo a uma barbearia só).

**Extensão de Chrome (onde o dono passa 100% do tempo):**
- UI injetada no WhatsApp Web (painel lateral, modais, botões nos contatos).
- Cadastro de cliente, tag, template, campanha — tudo dentro do WhatsApp Web.
- Import de CSV pela própria extensão.
- Executa disparo simulando ação humana na sessão logada do dono.

**Superfície web mínima (fora da extensão):**
- Página de vendas (`/`) — pra quem chegou pelo Google e ainda não é cliente.
- Fluxo de compra + ativação de licença (checkout, confirmação de pagamento).
- Página `/ativar` onde o dono cola um código de ativação **uma vez** pra parear a extensão com a licença dele. Depois disso ele nunca mais precisa abrir o site.
- Painel admin (só pra você) pra ver clientes ativos, licenças, revogar acesso. Sem prioridade no MVP.

## O que apagar do que já foi construído

- `src/routes/auth.tsx` — não tem login de dono de barbearia.
- `src/routes/_authenticated/` inteiro (o `route.tsx` guard + `app.tsx` com criar/listar barbearia).
- Botão Google OAuth, tudo relacionado a `supabase.auth` no fluxo do cliente final.

**Manter:**
- Todo o schema do banco (`barbershops`, `customers`, `campaigns`, `message_jobs`, `extension_tokens` etc.). Ele continua válido — só muda **quem** cria os registros (a extensão via API, não uma tela web).
- RLS permanece, mas o acesso principal passa a ser via **token da extensão** (endpoint público que valida token → resolve `barbershop_id` → usa `supabaseAdmin` com filtro manual e isolamento testado).
- Landing (`/`) — vira página de vendas de verdade depois.

## O que construir agora (ordem revisada)

1. **Limpar** as telas de auth/app que não fazem sentido no modelo novo.
2. **Fluxo de ativação minimalista** pro MVP de teste:
   - Como ainda não tem checkout, criar uma página `/ativar` simples onde você (dono do produto) gera manualmente um código de ativação pra uma barbearia de teste.
   - O dono cola o código na extensão → extensão troca por um `extension_token` → guarda no `chrome.storage` → daí em diante autentica sozinha.
3. **API pública da extensão** (`/api/public/extension/*`), todos os endpoints com:
   - Validação do token no header.
   - Resolução tenant → `barbershop_id`.
   - Teste automatizado obrigatório de isolamento (token da barbearia A não pode ver dado da B) — isso continua inegociável.
   - Endpoints: listar/criar cliente, criar tag, template, campanha, buscar próximo job da fila, marcar job como enviado/falhou.
4. **Regras já travadas** continuam valendo: TTL de 48h em job, revogação de token, abstração de envio (mesmo que hoje o único "sender" seja a extensão).
5. **Extensão em si** — Manifest V3, injeta painel no WhatsApp Web, consome a API acima. Essa parte eu construo em paralelo (o sandbox empacota como .zip pra você instalar unpacked no Chrome).

## Detalhes técnicos

- Endpoints da extensão ficam em `src/routes/api/public/extension/*` (o prefixo `/api/public/*` bypassa auth de site publicado — a segurança é feita **manualmente** dentro do handler validando o token).
- Handler carrega `supabaseAdmin` dinamicamente e faz o filtro por `barbershop_id` no código, já que RLS baseada em `auth.uid()` não se aplica quando quem chama é a extensão com token próprio.
- CORS liberado só pra origem `https://web.whatsapp.com` nesses endpoints.
- Token da extensão continua guardado como hash (SHA-256) no banco; o valor cru só existe no `chrome.storage` do dono.
- `extension_tokens` ganha `last_used_at` e botão de revogar (você revoga pelo painel admin quando existir; enquanto isso, via SQL).

## O que fica pra depois do MVP

- Página de vendas de verdade + checkout + geração automática de código de ativação após pagamento.
- Painel admin pra você gerenciar licenças/clientes ativos.
- Health checks e alerta por e-mail quando a extensão quebra por mudança de seletor do WhatsApp Web.

## Confirma?

Se aprovar, eu já começo apagando as rotas de auth/app que não servem mais e monto os endpoints públicos da extensão com o teste de isolamento por tenant.
