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
  return needles.filter((n) => n.trim() && haystack.includes(normalize(n)));
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
          const positiveHits = countMatches(searchText, p.palavras_chave_positivas ?? []);
          if (positiveHits.length === 0) continue;

          const negativeHits = countMatches(searchText, p.palavras_chave_negativas ?? []);
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

        scored.sort((a, b) => b.score - a.score);
        const top = scored.slice(0, 3);

        const confiancaSuficiente = top.length > 0 && top[0].score >= CONFIDENCE_THRESHOLD;
        const ambiguo = top.length >= 2 && Math.abs(top[0].score - top[1].score) < AMBIGUITY_GAP && top[0].score >= CONFIDENCE_THRESHOLD;

        return jsonResponse(request, {
          ok: true,
          confianca_suficiente: confiancaSuficiente && !ambiguo,
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
        });
      },
    },
  },
});
