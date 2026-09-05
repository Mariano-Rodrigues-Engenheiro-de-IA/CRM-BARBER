// GET  /api/public/extension/anamnese?customer_id=X -> busca a ficha (ou null, se nunca preenchida)
// POST /api/public/extension/anamnese -> cria ou atualiza (um registro só por paciente)

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const SELECT =
  "id, customer_id, health_conditions, medications, allergies, allergies_other, is_pregnant, is_breastfeeding, skin_type, keloid_tendency, procedure_history, notes, filled_at, updated_at";

const postSchema = z.object({
  customer_id: z.string().uuid(),
  health_conditions: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  medications: z.string().trim().max(2000).nullable().optional(),
  allergies: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  allergies_other: z.string().trim().max(500).nullable().optional(),
  is_pregnant: z.boolean().nullable().optional(),
  is_breastfeeding: z.boolean().nullable().optional(),
  skin_type: z.number().int().min(1).max(6).nullable().optional(),
  keloid_tendency: z.boolean().nullable().optional(),
  procedure_history: z.string().trim().max(4000).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

export const Route = createFileRoute("/api/public/extension/anamnese")({
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
          .from("anamnese_forms")
          .select(SELECT)
          .eq("barbershop_id", shop)
          .eq("customer_id", customerId)
          .maybeSingle();
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        return jsonResponse(request, { ok: true, anamnese: data ?? null });
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
        const { customer_id, ...rest } = parsed.data;
        const { data, error } = await supabaseAdmin
          .from("anamnese_forms")
          .upsert(
            {
              barbershop_id: shop,
              customer_id,
              ...rest,
              medications: rest.medications ?? null,
              allergies_other: rest.allergies_other ?? null,
              is_pregnant: rest.is_pregnant ?? null,
              is_breastfeeding: rest.is_breastfeeding ?? null,
              skin_type: rest.skin_type ?? null,
              keloid_tendency: rest.keloid_tendency ?? null,
              procedure_history: rest.procedure_history ?? null,
              notes: rest.notes ?? null,
              filled_at: new Date().toISOString(),
            },
            { onConflict: "customer_id" },
          )
          .select(SELECT)
          .single();
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        return jsonResponse(request, { ok: true, anamnese: data });
      },
    },
  },
});
