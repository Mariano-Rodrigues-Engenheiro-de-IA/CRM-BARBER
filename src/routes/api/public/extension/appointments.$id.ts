// PATCH  /api/public/extension/appointments/:id -> atualiza (remarcar, concluir, editar)
// DELETE /api/public/extension/appointments/:id -> cancela (soft: status = 'canceled')

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
  customer_id: z.string().uuid().optional().nullable(),
  professional_id: z.string().uuid().optional().nullable(),
  service_id: z.string().uuid().optional().nullable(),
  scheduled_at: z.string().min(4).max(40).optional(),
  duration_minutes: z.number().int().min(5).max(480).optional(),
  status: z.enum(["scheduled", "confirmed", "done", "canceled"]).optional(),
});

export const Route = createFileRoute("/api/public/extension/appointments/$id")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

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
          .from("appointments")
          .update(parsed.data)
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id)
          .select("id, title, notes, customer_id, professional_id, service_id, scheduled_at, duration_minutes, status")
          .maybeSingle();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        if (!data) {
          return jsonResponse(request, { ok: false, error: "Not found" }, { status: 404 });
        }
        return jsonResponse(request, { ok: true, appointment: data });
      },

      DELETE: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const { error } = await supabaseAdmin
          .from("appointments")
          .update({ status: "canceled" })
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
