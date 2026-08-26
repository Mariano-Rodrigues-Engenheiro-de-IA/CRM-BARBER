// POST /api/public/extension/products/search -> busca produtos por
// palavra-chave (Parte 2 da especificação — fase 1, só camada de
// palavra-chave; camada semântica/embeddings fica para depois).
//
// Retorna até 3 candidatos com score de confiança, sinalizando quando a
// IA deve perguntar ao cliente (ambíguo / baixa confiança) em vez de
// escolher sozinha — a IA nunca decide a lógica de busca, só reage ao
// resultado já pronto.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const CONFIDENCE_THRESHOLD = 0.75;
const AMBIGUITY_GAP = 0.1;

const bodySchema = z.object({
  texto_pedido: z.string().trim().min(1).max(2000),
  contexto_conversa: z.string().trim().max(4000).optional(),
});

type ProductRow = {
  id: string;
  name: string;
  category: string | null;
  palavras_chave_positivas: string[];
  palavras_chave_negativas: string[];
  produto_alternativo_sugerido: string | null;
  tipo_precificacao: string;
  sempre_escalar_humano: boolean;
  motivo_escalar: string | null;
  variaveis_obrigatorias: string[];
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // remove acentos, comparação mais tolerante
}

function countMatches(haystack: string, needles: string[]): string[] {
  if (!needles?.length) return [];
  // Bidirecional: conta como match tanto quando a palavra-chave aparece
  // dentro do texto do cliente (caso normal, cliente escreve uma frase
  // completa) quanto quando o texto do cliente aparece dentro da
  // palavra-chave (caso de resposta curta, ex: cliente responde só
  // "Vinil" a uma pergunta de desambiguação, e a palavra-chave cadastrada
  // é "adesivo vinil" - "vinil" nunca poderia "conter" a frase maior,
  // só o contrário). Sem isso, respostas de uma palavra só nunca batiam
  // contra palavras-chave de duas ou mais palavras.
  return needles.filter((n) => {
    const needle = normalize(n);
    if (!n.trim()) return false;
    return haystack.includes(needle) || (haystack.length >= 3 && needle.includes(haystack));
  });
}

const APPROX_STEM_MIN_LEN = 5;

/** Quebra um texto normalizado em palavras individuais (>=4 letras),
 * para comparação por radical. */
function words(text: string): string[] {
  return text.split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
}

/** Duas palavras "compartilham radical" se os primeiros
 * APPROX_STEM_MIN_LEN caracteres forem idênticos e ambas tiverem pelo
 * menos esse tamanho - captura variações de flexão em português
 * (laminado/laminação/laminada, holográfico/holografia) sem precisar
 * de biblioteca de linguística nem cadastrar manualmente cada forma. */
function sharesStem(a: string, b: string): boolean {
  if (a.length < APPROX_STEM_MIN_LEN || b.length < APPROX_STEM_MIN_LEN) return false;
  return a.slice(0, APPROX_STEM_MIN_LEN) === b.slice(0, APPROX_STEM_MIN_LEN);
}

/** Match aproximado por radical: usado só quando NENHUMA palavra-chave
 * bateu por correspondência exata (countMatches). Para cada
 * palavra-chave, quebra em palavras e exige que TODAS as palavras
 * significativas dela tenham alguma palavra de radical parecido no
 * texto do cliente - assim "corte contorno laminado" bate em "corte
 * contorno com laminação" mesmo com "com" no meio e "laminação" em vez
 * de "laminado", sem impedir que frases realmente diferentes batam à
 * toa (exige as 3 palavras, não só uma).
 * Bug real que motivou isso: "adesivo com laminação" nunca batia em
 * "adesivo laminado" porque exigia a frase inteira idêntica - o
 * cliente real nunca fala do jeito exato cadastrado, tem flexão de
 * palavra e conectivos no meio. Cadastrar manualmente cada variação
 * (laminado/laminação/laminada) não escala - a fonte real do problema
 * é exigir string idêntica em vez de reconhecer palavras aparentadas. */
function countApproxMatches(searchText: string, needles: string[]): string[] {
  if (!needles?.length) return [];
  const searchWords = words(searchText);
  if (!searchWords.length) return [];
  return needles.filter((n) => {
    const needleWords = words(normalize(n));
    if (!needleWords.length) return false;
    return needleWords.every((nw) => searchWords.some((sw) => sharesStem(nw, sw)));
  });
}

// Palavras comuns demais no nome de um produto para servirem de
// palavra-chave sozinhas (evita falso positivo tipo "de" ou "com").
const STOPWORDS = new Set(["de", "da", "do", "das", "dos", "com", "para", "em", "e", "ou", "a", "o", "os", "as", "no", "na"]);

/** Extrai do nome do produto as palavras significativas (>=4 letras,
 * fora da lista de stopwords) para servirem de rede de segurança: se
 * nenhuma palavra_chave_positiva cadastrada bateu, mas uma palavra óbvia
 * do próprio NOME do produto aparece no pedido do cliente (ex: "Vinil"
 * dentro de "Adesivo Vinil Corte Contorno"), o produto ainda deve
 * aparecer como candidato — o cadastro manual de palavras-chave pode
 * esquecer alguma, mas o nome do produto está sempre lá. */
function nameTokens(name: string): string[] {
  return normalize(name)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

export const Route = createFileRoute("/api/public/ai/products/search")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
        }

        // barbershop_id SEMPRE vem do token autenticado, nunca do corpo da
        // requisição — filtro obrigatório de isolamento (Parte 4 da spec),
        // primeira condição da query, antes de qualquer lógica de matching.
        const { data: products, error } = await supabaseAdmin
          .from("products")
          .select(
            "id, name, category, palavras_chave_positivas, palavras_chave_negativas, produto_alternativo_sugerido, tipo_precificacao, sempre_escalar_humano, motivo_escalar, variaveis_obrigatorias",
          )
          .eq("barbershop_id", auth.token.barbershop_id)
          .eq("active", true);

        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }

        const searchText = normalize(`${parsed.data.texto_pedido} ${parsed.data.contexto_conversa ?? ""}`);
        const rows = (products ?? []) as ProductRow[];

        type Scored = { product: ProductRow; score: number; matchedNegative: boolean };
        const scored: Scored[] = [];

        for (const p of rows) {
          let positiveHits = countMatches(searchText, p.palavras_chave_positivas ?? []);
          let fromNameFallback = false;
          let fromApproxMatch = false;
          if (positiveHits.length === 0) {
            // Antes de cair na rede de segurança do nome, tenta match
            // por radical (aproximado) contra as próprias palavras-chave
            // curadas - cobre flexões de palavra (laminado/laminação)
            // sem exigir que o cadastro preveja cada variação manualmente.
            const approxHits = countApproxMatches(searchText, p.palavras_chave_positivas ?? []);
            if (approxHits.length > 0) {
              positiveHits = approxHits;
              fromApproxMatch = true;
            } else {
              // Última rede de segurança: nenhuma palavra-chave cadastrada
              // bateu, nem por radical, mas talvez uma palavra óbvia do
              // próprio nome do produto apareça no pedido do cliente
              // (cadastro manual pode ter esquecido de incluir essa
              // palavra na lista).
              const nameHits = countMatches(searchText, nameTokens(p.name));
              if (nameHits.length === 0) continue;
              positiveHits = nameHits;
              fromNameFallback = true;
            }
          }

          // Negativas também usam match por radical - senão a mesma
          // lacuna de flexão de palavra (ex: "laminado" cadastrado como
          // negativa, mas o cliente disse "laminação") deixaria a
          // negativa de furar exatamente nos mesmos casos que acabamos
          // de corrigir para as positivas.
          const negativeHits = [
            ...countMatches(searchText, p.palavras_chave_negativas ?? []),
            ...countApproxMatches(searchText, p.palavras_chave_negativas ?? []),
          ];
          // Bater UMA palavra-chave já é forte evidência — na prática, um
          // cliente real dificilmente usa vários sinônimos do mesmo produto
          // na mesma mensagem (ex: "banner" OU "faixa promocional", nunca os
          // dois juntos). A fórmula antiga (hits / total_de_palavras)
          // penalizava isso, fazendo quase toda busca real cair abaixo do
          // limiar de confiança mesmo em casos óbvios. O que realmente
          // importa pra decidir "confiança suficiente" é se existe
          // AMBIGUIDADE entre produtos diferentes (checado depois, via
          // AMBIGUITY_GAP), não quantas palavras da lista bateram.
          let score = Math.min(1, 0.85 + (positiveHits.length - 1) * 0.05);

          if (fromApproxMatch) {
            // Peso levemente reduzido para match por radical - é uma
            // palavra-chave curada de verdade, só não bateu por igualdade
            // exata (flexão diferente), então merece mais confiança que
            // a rede de segurança do nome, mas um pouco menos que match
            // exato, para casos-limite não competirem de igual pra igual
            // com curadoria 100% confirmada.
            score = score * 0.85;
          }

          if (fromNameFallback) {
            // Peso reduzido para hits vindos só do nome do produto, não de
            // palavra-chave curada. Bug real visto em produção: buscar
            // "banner acabamento em madeira" acionava a rede de segurança
            // em "Lona com Acabamento em Ilhós" (via a palavra genérica
            // "acabamento") e em "Cavalete de Madeira" (via "madeira"),
            // competindo de igual para igual com o Banner de madeira, que
            // tinha batido por palavra-chave curada de verdade. A rede de
            // segurança deve servir só de último recurso (como no caso do
            // "Vinil", quando nenhuma palavra-chave de nenhum produto bate
            // em nada) — nunca disputar ambiguidade com um match curado.
            score = score * 0.6;
          }

          if (negativeHits.length > 0) {
            // Palavra-chave negativa bateu — reduz drasticamente a
            // confiança neste produto, mesmo com boas palavras positivas.
            score = score * 0.15;
          }

          scored.push({ product: p, score, matchedNegative: negativeHits.length > 0 });

          // Se bateu negativa e existe alternativo sugerido, injeta o
          // alternativo com pontuação alta — é o mecanismo que evita o
          // erro real (placa confundida com banner).
          if (negativeHits.length > 0 && p.produto_alternativo_sugerido) {
            const alt = rows.find((r) => r.id === p.produto_alternativo_sugerido);
            if (alt && !scored.some((s) => s.product.id === alt.id)) {
              scored.push({ product: alt, score: 0.9, matchedNegative: false });
            }
          }
        }

        // Deduplica por produto: um mesmo produto pode entrar na lista duas
        // vezes por dois caminhos diferentes - batendo direto pelas próprias
        // palavras-chave positivas E sendo injetado como alternativo de
        // outro produto que bateu negativa (ex: "determinação judicial" é ao
        // mesmo tempo palavra positiva da Placa e aciona a negativa do
        // Banner, que também injeta a Placa como alternativo). Sem isso, o
        // mesmo id_produto aparecia duas vezes no resultado, com scores
        // diferentes, confundindo a decisão de ambiguidade da IA.
        const bestById = new Map<string, (typeof scored)[number]>();
        for (const s of scored) {
          const existing = bestById.get(s.product.id);
          if (!existing || s.score > existing.score) bestById.set(s.product.id, s);
        }
        const deduped = [...bestById.values()];

        deduped.sort((a, b) => b.score - a.score);
        const top = deduped.slice(0, 3);

        const confiancaSuficiente = top.length > 0 && top[0].score >= CONFIDENCE_THRESHOLD;
        const ambiguo = top.length >= 2 && Math.abs(top[0].score - top[1].score) < AMBIGUITY_GAP && top[0].score >= CONFIDENCE_THRESHOLD;
        const identificadoComSucesso = confiancaSuficiente && !ambiguo;

        return jsonResponse(request, {
          ok: true,
          confianca_suficiente: identificadoComSucesso,
          ambiguo,
          resultados: top.map((s) => ({
            id_produto: s.product.id,
            nome_produto: s.product.name,
            categoria: s.product.category,
            score: Math.round(s.score * 100) / 100,
            sempre_escalar_humano: s.product.sempre_escalar_humano,
            motivo_escalar: s.product.motivo_escalar,
            tipo_precificacao: s.product.tipo_precificacao,
            variaveis_obrigatorias: s.product.variaveis_obrigatorias ?? [],
          })),
          // Aviso colado direto no resultado, não em algum lugar distante do
          // prompt — bug real visto em produção: mesmo depois de identificar
          // um produto SEM variação nenhuma (Squeezy) com confiança alta, a
          // IA chamava buscar_produto de novo a cada resposta do cliente
          // durante o roteiro (ex: cliente respondeu só "50"), mesmo com
          // regra de prompt explícita dizendo pra não fazer isso. A hipótese
          // é que um aviso no próprio resultado da ferramenta, no momento em
          // que ela acabou de ser chamada, tem mais chance de ser seguido do
          // que uma regra em outro lugar do texto do prompt.
          ...(identificadoComSucesso
            ? {
                aviso_importante:
                  "Produto identificado com confiança. NÃO chame buscar_produto de novo para este mesmo pedido, mesmo que o cliente responda perguntas do roteiro (quantidade, tamanho, etc.) depois disso — use o id_produto acima diretamente em detalhar_produto e calcular_produto.",
              }
            : {}),
        });
      },
    },
  },
});
