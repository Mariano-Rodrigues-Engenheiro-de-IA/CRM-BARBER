// PATCH  /api/public/extension/products/:id -> edita
// DELETE /api/public/extension/products/:id -> desativa (soft delete)
// GET    /api/public/extension/products/:id -> ficha técnica completa
//   (Parte 2 da especificação — busca em duas etapas: depois que
//   /products/search já identificou o produto certo com confiança
//   suficiente, o agente chama este endpoint para trazer tabela de
//   preços/fórmula/regras especiais só daquele único produto, em vez de
//   sobrecarregar o contexto da IA com a ficha completa de vários
//   candidatos na busca inicial)

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import type { Json } from "@/integrations/supabase/types";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().max(60).optional().nullable(),
  price: z.number().min(0).max(1000000).optional().nullable(),
  active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  palavras_chave_positivas: z.array(z.string().trim().min(1)).optional(),
  palavras_chave_negativas: z.array(z.string().trim().min(1)).optional(),
  produto_alternativo_sugerido: z.string().uuid().optional().nullable(),
  tipo_precificacao: z.enum(["fixo", "tabela_faixa", "formula_area"]).optional(),
  tabela_precos: z.custom<Json>().optional().nullable(),
  formula_calculo: z.custom<Json>().optional().nullable(),
  variaveis_obrigatorias: z.array(z.string().trim().min(1)).optional(),
  // Lista ordenada [{ campo, pergunta }] — o roteiro exato que a IA segue
  // ao conduzir o atendimento deste produto, em vez de formular a
  // pergunta por conta própria a partir de variaveis_obrigatorias.
  roteiro_atendimento: z.array(z.object({ campo: z.string().trim().min(1), pergunta: z.string().trim().min(1) })).optional().nullable(),
  pedido_minimo: z.string().trim().max(200).optional().nullable(),
  sempre_escalar_humano: z.boolean().optional(),
  motivo_escalar: z.string().trim().max(500).optional().nullable(),
  link_catalogo: z.string().trim().max(500).optional().nullable(),
  mensagem_apresentacao: z.string().trim().max(1000).optional().nullable(),
  observacoes_regras_especiais: z.string().trim().max(2000).optional().nullable(),
  moeda: z.string().trim().max(10).optional(),
});

const FULL_SELECT =
  "id, name, category, price, active, sort_order, palavras_chave_positivas, palavras_chave_negativas, produto_alternativo_sugerido, tipo_precificacao, tabela_precos, formula_calculo, variaveis_obrigatorias, roteiro_atendimento, pedido_minimo, sempre_escalar_humano, motivo_escalar, link_catalogo, mensagem_apresentacao, observacoes_regras_especiais, moeda";

export const Route = createFileRoute("/api/public/extension/products/$id")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      GET: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        // Mesma validação de formato usada em calcular_produto — erro claro
        // pra IA reconhecer e chamar buscar_produto de novo, em vez do erro
        // cru de sintaxe SQL quando id_produto não é um UUID de verdade.
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(params.id)) {
          return jsonResponse(request, {
            ok: false,
            error: `id_produto inválido: "${params.id}". Use exatamente o id_produto devolvido por buscar_produto. Chame buscar_produto novamente se necessário.`,
          }, { status: 400 });
        }
        // barbershop_id SEMPRE do token autenticado — mesma regra de
        // isolamento da Parte 4: nunca resolvido por parâmetro da URL.
        const { data, error } = await supabaseAdmin
          .from("products")
          .select(FULL_SELECT)
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id)
          .maybeSingle();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        // Produto de outra empresa (ou inexistente) devolve 404 igual —
        // nunca revela se o id existe fora do escopo desta barbearia.
        if (!data) return jsonResponse(request, { ok: false, error: "Not found" }, { status: 404 });
        return jsonResponse(request, {
          ok: true,
          product: {
            id_produto: data.id,
            nome_produto: data.name,
            categoria: data.category,
            ativo: data.active,
            tipo_precificacao: data.tipo_precificacao,
            preco_fixo: data.price,
            tabela_precos: data.tabela_precos,
            formula_calculo: data.formula_calculo,
            variaveis_obrigatorias: data.variaveis_obrigatorias ?? [],
            roteiro_atendimento: data.roteiro_atendimento ?? null,
            pedido_minimo: data.pedido_minimo,
            sempre_escalar_humano: data.sempre_escalar_humano,
            motivo_escalar: data.motivo_escalar,
            link_catalogo: data.link_catalogo,
            mensagem_apresentacao: data.mensagem_apresentacao,
            observacoes_regras_especiais: data.observacoes_regras_especiais,
            moeda: data.moeda,
          },
        });
      },

      PATCH: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
        }
        const { data, error } = await supabaseAdmin
          .from("products")
          .update(parsed.data)
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id)
          .select("id, name, category, price, active, sort_order")
          .maybeSingle();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        if (!data) return jsonResponse(request, { ok: false, error: "Not found" }, { status: 404 });
        return jsonResponse(request, { ok: true, product: data });
      },

      DELETE: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const { error } = await supabaseAdmin
          .from("products")
          .update({ active: false })
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id);
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true });
      },
    },
  },
});
