// PATCH  /api/public/extension/dental-payments/:id -> edita um pagamento lançado
// DELETE /api/public/extension/dental-payments/:id -> remove um pagamento errado

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const SELECT = "id, customer_id, amount_cents, notes, paid_at, created_at";

const patchSchema = z.object({
  amount_cents: z.number().int().min(1).max(100_000_000).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  paid_at: z.string().datetime().optional(),
});

export const Route = createFileRoute("/api/public/extension/dental-payments/$id")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      PATCH: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const shop = auth.token.barbershop_id;
        const parsed = patchSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
        }
        const { data, error } = await supabaseAdmin
          .from("dental_payments")
          .update(parsed.data)
          .eq("id", params.id)
          .eq("barbershop_id", shop)
          .select(SELECT)
          .maybeSingle();
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        if (!data) return jsonResponse(request, { ok: false, error: "Pagamento não encontrado." }, { status: 404 });
        return jsonResponse(request, { ok: true, payment: data });
      },

      DELETE: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const shop = auth.token.barbershop_id;
        const { error } = await supabaseAdmin
          .from("dental_payments")
          .delete()
          .eq("id", params.id)
          .eq("barbershop_id", shop);
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        return jsonResponse(request, { ok: true });
      },
    },
  },
});
