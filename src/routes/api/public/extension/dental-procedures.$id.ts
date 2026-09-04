// PATCH  /api/public/extension/dental-procedures/:id -> edita (ex: marcar como pago)
// DELETE /api/public/extension/dental-procedures/:id -> remove um lançamento errado

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const SELECT = "id, customer_id, appointment_id, tooth_numbers, procedure_type, price_cents, paid, notes, performed_at, created_at";

const patchSchema = z.object({
  appointment_id: z.string().uuid().nullable().optional(),
  tooth_numbers: z.array(z.number().int().min(11).max(85)).max(32).optional(),
  procedure_type: z.string().trim().min(1).max(120).optional(),
  price_cents: z.number().int().min(0).max(100_000_000).optional(),
  paid: z.boolean().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  performed_at: z.string().datetime().optional(),
});

export const Route = createFileRoute("/api/public/extension/dental-procedures/$id")({
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
          .from("dental_procedures")
          .update(parsed.data)
          .eq("id", params.id)
          .eq("barbershop_id", shop)
          .select(SELECT)
          .maybeSingle();
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        if (!data) return jsonResponse(request, { ok: false, error: "Procedimento não encontrado." }, { status: 404 });
        return jsonResponse(request, { ok: true, procedure: data });
      },

      DELETE: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const shop = auth.token.barbershop_id;
        const { error } = await supabaseAdmin
          .from("dental_procedures")
          .delete()
          .eq("id", params.id)
          .eq("barbershop_id", shop);
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        return jsonResponse(request, { ok: true });
      },
    },
  },
});
