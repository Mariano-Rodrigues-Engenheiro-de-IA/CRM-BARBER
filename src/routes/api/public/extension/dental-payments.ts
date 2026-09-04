// GET  /api/public/extension/dental-payments?customer_id=X -> lista (mais antigo primeiro)
// POST /api/public/extension/dental-payments -> lança um pagamento recebido

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const SELECT = "id, customer_id, amount_cents, notes, paid_at, created_at";

const postSchema = z.object({
  customer_id: z.string().uuid(),
  amount_cents: z.number().int().min(1).max(100_000_000),
  notes: z.string().trim().max(500).nullable().optional(),
  paid_at: z.string().datetime().optional(),
});

export const Route = createFileRoute("/api/public/extension/dental-payments")({
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
          .from("dental_payments")
          .select(SELECT)
          .eq("barbershop_id", shop)
          .eq("customer_id", customerId)
          .order("paid_at", { ascending: true });
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        return jsonResponse(request, { ok: true, payments: data ?? [] });
      },

      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const shop = auth.token.barbershop_id;
        const parsed = postSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
        }
        const { data: customer } = await supabaseAdmin
          .from("customers")
          .select("id")
          .eq("id", parsed.data.customer_id)
          .eq("barbershop_id", shop)
          .maybeSingle();
        if (!customer) {
          return jsonResponse(request, { ok: false, error: "Paciente não encontrado." }, { status: 404 });
        }
        const { data, error } = await supabaseAdmin
          .from("dental_payments")
          .insert({
            barbershop_id: shop,
            customer_id: parsed.data.customer_id,
            amount_cents: parsed.data.amount_cents,
            notes: parsed.data.notes ?? null,
            ...(parsed.data.paid_at ? { paid_at: parsed.data.paid_at } : {}),
          })
          .select(SELECT)
          .single();
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        return jsonResponse(request, { ok: true, payment: data });
      },
    },
  },
});
