// GET  /api/public/extension/products -> lista (ativos por padrão)
// POST /api/public/extension/products -> cria
//
// Campos novos (palavras-chave, tabela de preços/fórmula, escalonamento,
// etc.) são todos OPCIONAIS — quem usa este endpoint só para o cadastro
// simples (ex.: Ranking de vendas) continua funcionando sem mudar nada;
// quem precisa do catálogo enriquecido (ex.: agente de IA da Gráfica
// Gavi) preenche os campos extras na mesma chamada.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().max(60).optional(),
  price: z.number().min(0).max(1000000).optional(),
  palavras_chave_positivas: z.array(z.string().trim().min(1)).optional(),
  palavras_chave_negativas: z.array(z.string().trim().min(1)).optional(),
  produto_alternativo_sugerido: z.string().uuid().optional().nullable(),
  tipo_precificacao: z.enum(["fixo", "tabela_faixa", "formula_area"]).optional(),
  tabela_precos: z.record(z.string(), z.unknown()).optional().nullable(),
  formula_calculo: z.record(z.string(), z.unknown()).optional().nullable(),
  variaveis_obrigatorias: z.array(z.string().trim().min(1)).optional(),
  pedido_minimo: z.string().trim().max(200).optional().nullable(),
  sempre_escalar_humano: z.boolean().optional(),
  motivo_escalar: z.string().trim().max(500).optional().nullable(),
  link_catalogo: z.string().trim().max(500).optional().nullable(),
  mensagem_apresentacao: z.string().trim().max(1000).optional().nullable(),
  observacoes_regras_especiais: z.string().trim().max(2000).optional().nullable(),
  moeda: z.string().trim().max(10).optional(),
});

const LIST_SELECT =
  "id, name, category, price, active, sort_order, palavras_chave_positivas, palavras_chave_negativas, tipo_precificacao, sempre_escalar_humano, variaveis_obrigatorias";

export const Route = createFileRoute("/api/public/extension/products")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const url = new URL(request.url);
        const includeInactive = url.searchParams.get("include_inactive") === "1";
        let query = supabaseAdmin
          .from("products")
          .select(LIST_SELECT)
          .eq("barbershop_id", auth.token.barbershop_id)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });
        if (!includeInactive) query = query.eq("active", true);
        const { data, error } = await query;
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, products: data ?? [] });
      },

      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
        }
        const { data, error } = await supabaseAdmin
          .from("products")
          .insert({ barbershop_id: auth.token.barbershop_id, ...parsed.data })
          .select(LIST_SELECT)
          .single();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, product: data });
      },
    },
  },
});
