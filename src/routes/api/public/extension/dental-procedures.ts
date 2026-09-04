// GET    /api/public/extension/dental-procedures?customer_id=X -> lista (mais recente primeiro)
// POST   /api/public/extension/dental-procedures -> registra um procedimento
// PATCH  /api/public/extension/dental-procedures/:id -> edita (ex: marcar como pago)
// DELETE /api/public/extension/dental-procedures/:id -> remove um lançamento errado

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const SELECT = "id, customer_id, appointment_id, tooth_number, procedure_type, price_cents, paid, notes, performed_at, created_at";

const postSchema = z.object({
  customer_id: z.string().uuid(),
  appointment_id: z.string().uuid().nullable().optional(),
  tooth_number: z.number().int().min(11).max(85).nullable().optional(),
  procedure_type: z.string().trim().min(1).max(120),
  price_cents: z.number().int().min(0).max(100_000_000).default(0),
  paid: z.boolean().default(false),
  notes: z.string().trim().max(2000).nullable().optional(),
  performed_at: z.string().datetime().optional(),
});

export const Route = createFileRoute("/api/public/extension/dental-procedures")({
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
          .from("dental_procedures")
          .select(SELECT)
          .eq("barbershop_id", shop)
          .eq("customer_id", customerId)
          .order("performed_at", { ascending: false });
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        return jsonResponse(request, { ok: true, procedures: data ?? [] });
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
        // Confere que o paciente é mesmo dessa barbearia antes de gravar.
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
          .from("dental_procedures")
          .insert({
            barbershop_id: shop,
            customer_id: parsed.data.customer_id,
            appointment_id: parsed.data.appointment_id ?? null,
            tooth_number: parsed.data.tooth_number ?? null,
            procedure_type: parsed.data.procedure_type,
            price_cents: parsed.data.price_cents,
            paid: parsed.data.paid,
            notes: parsed.data.notes ?? null,
            ...(parsed.data.performed_at ? { performed_at: parsed.data.performed_at } : {}),
          })
          .select(SELECT)
          .single();
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        return jsonResponse(request, { ok: true, procedure: data });
      },
    },
  },
});
