# Plano — CRM Assinaturas v0.10

Boa, disparo funcionando destrava a próxima fase. Antes de mexer, quero alinhar o escopo — é mudança grande e prefiro confirmar antes de sair codando.

## 1. Painel do CRM sai da sidebar do WhatsApp

Hoje o CRM mora num painel colado no WhatsApp Web. Vai virar:

- **Botão "Assinaturas" na sidebar do WhatsApp** → abre nova aba do navegador (`window.open`) no painel completo.
- **Painel completo** = nova rota web do próprio CRM (ex: `/painel`), hospedada no mesmo domínio Lovable, autenticada pelo token da extensão (passado via query string / storage).
- A sidebar dentro do WhatsApp fica minimalista: só status de pareamento + botão "Abrir painel" + fila de disparo em andamento (com botão pausar).

## 2. Kanban de assinantes

Dentro do painel, tela principal = Kanban com colunas configuráveis. MVP:

- Colunas fixas iniciais: **Ativos**, **Inadimplentes**, **Reativar**, **Cancelados**.
- Cada card = 1 contato (nome + telefone + tags).
- **Drag-and-drop** entre colunas muda o `status` do customer.
- **Lixeira no card** remove o contato (com confirm).
- Botão **+ Adicionar** em cada coluna: abre modal com 2 abas
  - "Escolher dos contatos do WhatsApp" (lista puxada via bridge, com busca e checkbox)
  - "Digitar manualmente" (nome + telefone)

## 3. Importação de planilha com substituição inteligente

- Botão **Importar planilha** no topo do Kanban.
- Formato aceito: CSV simples `nome;telefone` (já implementado).
- Comportamento **novo**: cada barbearia tem UMA "planilha ativa" por vez. Ao importar nova planilha:
  - Contatos que **estavam** na planilha anterior e **não estão** na nova → removidos do CRM (marcados como `archived`, não deletados de fato, pra preservar histórico).
  - Contatos **novos** → inseridos.
  - Contatos que continuam → atualizados (nome, tags mescladas).
- Contatos adicionados manualmente (fora de planilha) **não são afetados** pela substituição.

Requer coluna nova `source` em `customers` (`spreadsheet` | `manual` | `whatsapp_contacts`) e coluna `spreadsheet_batch_id` para agrupar.

## 4. Campanhas com controle real

- **Pausar/Retomar** campanha em andamento (botão na tela de progresso). Backend: novo endpoint `PATCH /campaigns/:id` com `status: 'paused' | 'running'`; o worker (extensão) só puxa jobs de campanhas `running`.
- **Ritmo configurável** com faixa (ex: entre 20 e 60 segundos, aleatório dentro da faixa) — reduz padrão de bot.
- **Variação de mensagens**: usuário informa até 3 variações; ao enfileirar jobs, cada job recebe uma variação aleatória (round-robin ou random). Backend: `campaigns.message_variants text[]` em vez de `message` único.

## 5. Layout — tema barbearia

- Paleta preto + amarelo (dourado), tipografia com peso, cantos levemente arredondados.
- Aplica no painel novo (rota `/painel`) e na sidebar reduzida da extensão.

---

## Escopo técnico resumido

**Backend (Supabase + rotas API):**
- Migração: `customers.source`, `customers.spreadsheet_batch_id`, `customers.archived_at`; `campaigns.message_variants text[]`, `campaigns.pace_seconds_min`, `campaigns.pace_seconds_max`.
- Nova rota `PATCH /api/public/extension/campaigns/:id` (pausar/retomar).
- Ajuste em `/customers/import` pra receber `mode: 'replace_spreadsheet'` e arquivar contatos ausentes.
- Ajuste em `/jobs/next` pra filtrar campanhas pausadas.
- Ajuste em `/campaigns` (POST) pra aceitar `message_variants` e faixa de pace.

**Painel web novo (rota `/painel`):**
- Autenticação via token da extensão (mesma tabela `extension_tokens`), passado via `?token=…` na primeira abertura, salvo em `localStorage` do domínio Lovable.
- Kanban (dnd-kit), modal de adicionar contatos, importador de planilha, tela de campanha.

**Extensão v0.10:**
- Sidebar simplificada: status + "Abrir painel de assinaturas" (abre nova aba) + campanhas em andamento com pausar.
- Bridge continua responsável só pelo envio silencioso e leitura de contatos.

---

## O que **não** vai entrar nesta rodada

- Envio de áudio/imagem (só texto por enquanto).
- Colunas de kanban criadas pelo usuário (fica com as 4 fixas).
- Templates salvos reutilizáveis (só variações dentro da campanha).
- Health checks / alertas por e-mail (fase seguinte, como combinado).

---

## Esforço estimado

Mudança grande — painel novo + kanban + refatoração de import/campanha. Estimativa: **1 a 2 dias** de trabalho meu de ponta a ponta, testando cada bloco.

Ordem que vou seguir se aprovar:

1. Migração de schema (customers + campaigns).
2. Ajustes nas rotas de API (import replace, pausar campanha, variações, pace range).
3. Painel web `/painel` com Kanban + import + adicionar contatos.
4. Refatoração da extensão v0.10 (sidebar reduzida + botão abrir painel + pausar campanha).
5. Skin preto/amarelo no painel e na sidebar.

Confirma que faz sentido assim, ou quer que eu ajuste alguma parte antes de começar?
