// GET /api/public/extension/dental-chart?customer_id=X -> devolve o payload salvo (ou null)
// PUT /api/public/extension/dental-chart -> salva o payload (upsert por customer_id)
//
// O payload em si (chart_data) é opaco pra nós — é o formato que a
// biblioteca react-advanced-odontogram exporta via getStatusChart() e
// carrega de volta via importStatus(). Não modelamos dente por dente
// nas nossas próprias colunas; a biblioteca já cuida disso e evolui
// suas próprias migrações de versão internamente.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import type { Json } from "@/integrations/supabase/types";

const putSchema = z.object({
  customer_id: z.string().uuid(),
  chart_data: z.record(z.string(), z.unknown()),
});

export const Route = createFileRoute("/api/public/extension/dental-chart")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const shop = auth.token.barbershop_id;
        const url = new URL(request.url);
        const customerId = url.searchParams.get("customer_id");
        if (!customerId) {
          return jsonResponse(request, { ok: false, error: "Falta o parâmetro customer_id." }, { status: 400 });
        }
        const { data, error } = await supabaseAdmin
          .from("dental_charts")
          .select("chart_data, updated_at")
          .eq("barbershop_id", shop)
          .eq("customer_id", customerId)
          .maybeSingle();
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        return jsonResponse(request, {
          ok: true,
          chart_data: data?.chart_data ?? null,
          updated_at: data?.updated_at ?? null,
        });
      },

      PUT: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const shop = auth.token.barbershop_id;
        const parsed = putSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: "Dados inválidos." }, { status: 400 });
        }
        // Confere que o paciente é mesmo dessa barbearia antes de gravar —
        // nunca confia só no customer_id que veio do cliente.
        const { data: customer } = await supabaseAdmin
          .from("customers")
          .select("id")
          .eq("id", parsed.data.customer_id)
          .eq("barbershop_id", shop)
          .maybeSingle();
        if (!customer) {
          return jsonResponse(request, { ok: false, error: "Paciente não encontrado." }, { status: 404 });
        }
        const { error } = await supabaseAdmin.from("dental_charts").upsert(
          {
            barbershop_id: shop,
            customer_id: parsed.data.customer_id,
            chart_data: parsed.data.chart_data as Json,
          },
          { onConflict: "customer_id" },
        );
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        return jsonResponse(request, { ok: true });
      },
    },
  },
});
