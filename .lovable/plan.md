## Contexto

O pedido tem 13 frentes e muda a base do produto: o WhatsApp passa a ser a fonte principal de dados (hoje é planilha). Isso não cabe em uma entrega só — proponho 4 fases, cada uma entregando algo utilizável. Você aprova a ordem (ou muda) e eu toco fase por fase.

---

## Fase 1 — Correções e base (rápida, sem risco)

**13. Envio de mídias (áudio/imagem/vídeo)** — varredura completa do fluxo: upload → bucket → URL assinada → painel → `panel-nudge` → background → bridge → `WPP.chat.sendFileMessage`. Suspeitas principais já mapeadas:
- a URL assinada expira em 1h, e a bridge baixa a mídia no momento do envio (campanha agendada = link morto);
- o `fetch` da mídia acontece dentro do contexto do web.whatsapp.com, que não tem o domínio do Storage liberado (CSP/CORS) — a correção provável é baixar a mídia no background da extensão e passar como base64/blob para a página;
- áudio como PTT exige `opus/ogg`, e o arquivo enviado pelo usuário normalmente é `mp3/m4a`.
Só depois de confirmar a causa real por log aplico a correção, sem mexer na arquitetura.

**5. Fim dos pop-ups nativos** — substituir os 9 `confirm()/alert()` restantes (painel, equipe, extensão, instalar) por modal/AlertDialog e toasts do próprio sistema.

**12. Renomear "Assinantes" → "Gestão de Assinaturas"** e mover para dentro dela: planos, valores, metas de assinatura. Configurações fica só com o que é geral (logo, sistema de origem, importação, integrações).

---

## Fase 2 — Sincronização com o WhatsApp (o coração da mudança)

**1. Sync de contatos, conversas, grupos e etiquetas.**
- A extensão lê da sessão logada (contatos, chats, grupos, labels do WhatsApp Business) e envia em lotes para o CRM.
- Novas tabelas: `wa_contacts`, `wa_labels`, `wa_contact_labels`, `wa_chats` (todas isoladas por barbearia, com RLS).
- Sync incremental (só o que mudou) + botão "sincronizar agora" e sync automática periódica.
- Planilha continua existindo como complemento; contatos ganham `source` (whatsapp | planilha | manual) e são deduplicados por telefone.

Sem esta fase, os itens 2, 7 e 9 não têm base de dados real.

---

## Fase 3 — Funis de Vendas + Abas

**2/3/4.** Nova seção **Funis de Vendas** no painel, com duas visões separadas e o mesmo Kanban já existente:
- **Funis por Abas** — abas próprias do CRM (Clientes Novos, Orçamentos, Agendamentos, Pós-venda, VIP, Perdidos), criáveis pelo usuário, com arrastar entre colunas.
- **Funis por Etiquetas** — colunas geradas a partir das etiquetas reais do WhatsApp sincronizadas.

**Abas visíveis dentro do WhatsApp Web**: a extensão injeta uma barra de abas logo acima da lista de conversas (não na lateral), sempre visível, com botão "+ nova aba". Clicar numa aba filtra a lista de conversas por aquele funil.

---

## Fase 4 — Clientes: vendas, histórico e ranking

**6/7.** No lançamento de venda da equipe, campo obrigatório de **cliente**, com busca por nome ou telefone na base sincronizada; se não achar, cadastro rápido inline (nome + telefone).

**8.** Perfil completo do cliente: total gasto, nº de compras, produtos, serviços, primeira e última compra, tempo de relacionamento (LTV), frequência, jornada.

**9.** **Ranking de clientes** nos mesmos moldes do ranking de barbeiros, com filtro Hoje / Semana / Mês / 90 dias / período personalizado.

**10.** Gestão de equipe passa a cruzar barbeiro × cliente: quem cada barbeiro fidelizou, clientes com maior LTV, clientes ativos e clientes em risco de abandono.

---

## Fase 5 — Página de vendas

**11.** Reescrita da landing para posicionar como **plataforma completa de gestão para barbearias** (assinaturas viram um módulo, não o produto). Só recursos que existirem de fato ao fim das fases acima. Feita por último, para não anunciar o que ainda não está pronto.

---

## Detalhes técnicos

- Novas tabelas com GRANT + RLS por barbearia, seguindo o padrão atual (`is_barbershop_member`).
- Sync roda na extensão (única com sessão do WhatsApp) e grava via rotas `/api/public/extension/*` autenticadas por token, como já é hoje.
- Cada integração nova em módulo próprio; nada de lógica nova enfiada em `painel.tsx` (que já tem 2.011 linhas) — a seção de Funis vira componente separado.
- Versão da extensão sobe para 0.20.x na Fase 2 e a atualização vai pela Chrome Web Store.

---

## O que preciso de você

1. Confirma a ordem das fases? Sugiro começar pela Fase 1 (mídia quebrada é bug ativo).
2. As abas do CRM dentro do WhatsApp devem filtrar a lista de conversas real, ou apenas ser atalhos que abrem o funil no painel?
3. Um contato pode estar em mais de uma aba/funil ao mesmo tempo, ou é exclusivo (uma coluna só, como o Kanban atual)?
