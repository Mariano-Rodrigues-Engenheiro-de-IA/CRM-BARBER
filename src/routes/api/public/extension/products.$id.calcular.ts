// POST /api/public/extension/products/:id/calcular -> calcula o valor
// final de um produto de forma DETERMINÍSTICA (Parte 3 da especificação),
// a partir do produto + variáveis já coletadas do cliente pelo agente.
//
// Existe para eliminar o risco de a IA aplicar a fórmula certa com o
// número errado, ou aplicar um adicional que não deveria (ex.: caso real
// do ilhós sendo somado indevidamente em lona que já inclui ilhós no
// preço) — o mesmo raciocínio que já levou a ferramenta "calcular" a
// existir, aplicado agora à camada de produto/preço, não só à aritmética
// pura.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const bodySchema = z.object({
  quantidade: z.number().min(0).optional(),
  variacao: z.string().trim().max(60).optional(), // ex.: "4x0", "4x1", "4x4"
  largura_m: z.number().min(0).max(100).optional(),
  altura_m: z.number().min(0).max(100).optional(),
  // Variáveis livres usadas pelas condições de adicionais/regras especiais
  // (ex.: { "acabamento": "madeira" } para bater com "acabamento = madeira").
  variaveis: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

type Faixa = { quantidade_min: number; quantidade_max: number; variacoes: Record<string, number> };
type TabelaPrecos = { faixas: Faixa[] };
type Adicional = { nome: string; valor: number; aplica_apenas_se?: string };
type RegraSolda = { aplica_se: string; valor_por_metro_linear_menor_medida: number };
type FormulaCalculo = {
  valor_m2: number;
  pedido_minimo_valor?: number;
  sangra_cm?: number;
  adicionais?: Adicional[];
  regra_solda?: RegraSolda;
};

/** Avalia condições simples do tipo "campo operador valor", combinadas com
 * " E " (todas precisam ser verdadeiras). NÃO usa eval/Function em texto
 * livre vindo do banco — só reconhece este formato restrito, mesmo
 * cuidado de segurança já aplicado na ferramenta "calcular". Retorna
 * false (não aplica) para qualquer condição que não reconheça, nunca
 * lança erro que travaria o cálculo inteiro. */
function evalCondition(condicao: string, vars: Record<string, string | number | boolean>): boolean {
  const partes = condicao.split(/\s+E\s+/i);
  return partes.every((parte) => {
    const m = parte.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*(=|==|!=|>=|<=|>|<)\s*(.+)$/);
    if (!m) return false;
    const [, campo, op, rawValor] = m;
    const atual = vars[campo];
    if (atual === undefined) return false;
    const valorTexto = rawValor.trim().replace(/^["']|["']$/g, "");
    const numAtual = typeof atual === "number" ? atual : Number(atual);
    const numValor = Number(valorTexto);
    const compararNumero = !Number.isNaN(numAtual) && !Number.isNaN(numValor);
    switch (op) {
      case "=":
      case "==":
        return compararNumero ? numAtual === numValor : String(atual) === valorTexto;
      case "!=":
        return compararNumero ? numAtual !== numValor : String(atual) !== valorTexto;
      case ">":
        return compararNumero && numAtual > numValor;
      case "<":
        return compararNumero && numAtual < numValor;
      case ">=":
        return compararNumero && numAtual >= numValor;
      case "<=":
        return compararNumero && numAtual <= numValor;
      default:
        return false;
    }
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const Route = createFileRoute("/api/public/extension/products/$id/calcular")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      POST: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
        }

        // barbershop_id SEMPRE do token — mesma regra de isolamento das
        // outras rotas de produto (Parte 4). Tentar calcular um produto de
        // outra empresa devolve "não encontrado", nunca executa o cálculo.
        const { data: product, error } = await supabaseAdmin
          .from("products")
          .select("id, name, price, tipo_precificacao, tabela_precos, formula_calculo, active")
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id)
          .maybeSingle();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        if (!product) return jsonResponse(request, { ok: false, error: "Not found" }, { status: 404 });

        const { quantidade, variacao, largura_m, altura_m, variaveis } = parsed.data;
        const vars = { ...(variaveis ?? {}), largura: largura_m, altura: altura_m, quantidade } as Record<
          string,
          string | number | boolean
        >;

        // ===== fixo: preço único, multiplica por quantidade se informada.
        if (product.tipo_precificacao === "fixo") {
          if (product.price == null) {
            return jsonResponse(request, { ok: false, error: "Produto sem preço fixo cadastrado." }, { status: 422 });
          }
          const qtd = quantidade && quantidade > 0 ? quantidade : 1;
          return jsonResponse(request, {
            ok: true,
            valor_total: round2(Number(product.price) * qtd),
            detalhes: { tipo: "fixo", preco_unitario: Number(product.price), quantidade: qtd },
          });
        }

        // ===== tabela_faixa: acha a faixa pela quantidade, pega a
        // variação certa dentro dela (ex.: 4x0/4x1/4x4). O valor na
        // tabela já é o total daquela faixa (não multiplica de novo).
        if (product.tipo_precificacao === "tabela_faixa") {
          const tabela = product.tabela_precos as TabelaPrecos | null;
          if (!tabela?.faixas?.length) {
            return jsonResponse(request, { ok: false, error: "Produto sem tabela de preços cadastrada." }, { status: 422 });
          }
          if (!quantidade) {
            return jsonResponse(request, { ok: false, error: "Informe a quantidade para calcular." }, { status: 400 });
          }
          const faixa = tabela.faixas.find((f) => quantidade >= f.quantidade_min && quantidade <= f.quantidade_max);
          if (!faixa) {
            return jsonResponse(request, {
              ok: false,
              error: `Quantidade ${quantidade} fora das faixas cadastradas para este produto — precisa de orçamento manual.`,
            }, { status: 422 });
          }
          const variacoesDisponiveis = Object.keys(faixa.variacoes ?? {});
          const chaveVariacao = variacao && faixa.variacoes[variacao] !== undefined ? variacao : null;
          if (!chaveVariacao) {
            if (variacoesDisponiveis.length > 1) {
              return jsonResponse(request, {
                ok: false,
                error: `Informe qual variação deseja: ${variacoesDisponiveis.join(", ")}.`,
              }, { status: 400 });
            }
            if (variacoesDisponiveis.length === 0) {
              return jsonResponse(request, { ok: false, error: "Faixa de preço sem variações cadastradas." }, { status: 422 });
            }
          }
          const chave = chaveVariacao ?? variacoesDisponiveis[0];
          return jsonResponse(request, {
            ok: true,
            valor_total: round2(faixa.variacoes[chave]),
            detalhes: { tipo: "tabela_faixa", faixa: { min: faixa.quantidade_min, max: faixa.quantidade_max }, variacao: chave },
          });
        }

        // ===== formula_area: largura(m) × altura(m) × valor_m2, com
        // sangra opcional, adicionais condicionais, regra de solda
        // condicional e valor mínimo do pedido.
        if (product.tipo_precificacao === "formula_area") {
          const formula = product.formula_calculo as FormulaCalculo | null;
          if (!formula?.valor_m2) {
            return jsonResponse(request, { ok: false, error: "Produto sem fórmula de cálculo cadastrada." }, { status: 422 });
          }
          if (!largura_m || !altura_m) {
            return jsonResponse(request, { ok: false, error: "Informe largura e altura (em metros) para calcular." }, { status: 400 });
          }

          const sangraM = (formula.sangra_cm ?? 0) / 100;
          const larguraCalc = largura_m + sangraM;
          const alturaCalc = altura_m + sangraM;
          const area = larguraCalc * alturaCalc * (quantidade && quantidade > 0 ? quantidade : 1);

          let valor = area * formula.valor_m2;
          const adicionaisAplicados: { nome: string; valor: number }[] = [];

          for (const ad of formula.adicionais ?? []) {
            const aplica = !ad.aplica_apenas_se || evalCondition(ad.aplica_apenas_se, vars);
            if (aplica) {
              valor += ad.valor;
              adicionaisAplicados.push({ nome: ad.nome, valor: ad.valor });
            }
          }

          let soldaAplicada = false;
          if (formula.regra_solda && evalCondition(formula.regra_solda.aplica_se, { largura: largura_m, altura: altura_m })) {
            const menorMedida = Math.min(largura_m, altura_m);
            valor += menorMedida * formula.regra_solda.valor_por_metro_linear_menor_medida;
            soldaAplicada = true;
          }

          const minimoAplicado = formula.pedido_minimo_valor != null && valor < formula.pedido_minimo_valor;
          if (minimoAplicado) valor = formula.pedido_minimo_valor!;

          return jsonResponse(request, {
            ok: true,
            valor_total: round2(valor),
            detalhes: {
              tipo: "formula_area",
              area_m2: round2(area),
              valor_m2: formula.valor_m2,
              adicionais_aplicados: adicionaisAplicados,
              solda_aplicada: soldaAplicada,
              minimo_aplicado: minimoAplicado,
            },
          });
        }

        return jsonResponse(request, { ok: false, error: "Tipo de precificação desconhecido." }, { status: 422 });
      },
    },
  },
});
