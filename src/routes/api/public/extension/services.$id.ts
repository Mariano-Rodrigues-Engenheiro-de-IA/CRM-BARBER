// PATCH  /api/public/extension/services/:id -> edita, aceita professional_ids opcional (substitui vinculos)
// DELETE /api/public/extension/services/:id -> desativa (soft delete)

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().max(60).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  duration_minutes: z.number().int().min(5).max(480).optional(),
  price: z.number().min(0).max(1000000).optional().nullable(),
  active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  professional_ids: z.array(z.string().uuid()).optional(),
});

export const Route = createFileRoute("/api/public/extension/services/$id")({
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
        const { professional_ids, ...serviceFields } = parsed.data;
        const { data, error } = await supabaseAdmin
          .from("services")
          .update(serviceFields)
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id)
          .select("id, name, category, description, duration_minutes, price, active, sort_order")
          .maybeSingle();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        if (!data) return jsonResponse(request, { ok: false, error: "Not found" }, { status: 404 });

        // professional_ids presente (mesmo vazio []) substitui os vínculos
        // por completo — omitido significa "não mexer nos vínculos".
        if (professional_ids !== undefined) {
          const { error: delErr } = await supabaseAdmin.from("professional_services").delete().eq("service_id", params.id);
          if (delErr) {
            return jsonResponse(request, { ok: false, error: `Falhou ao atualizar vínculos: ${delErr.message}` }, { status: 500 });
          }
          if (professional_ids.length > 0) {
            const { error: insErr } = await supabaseAdmin
              .from("professional_services")
              .insert(professional_ids.map((pid) => ({ service_id: params.id, professional_id: pid })));
            if (insErr) {
              return jsonResponse(request, { ok: false, error: `Falhou ao vincular profissionais: ${insErr.message}` }, { status: 500 });
            }
          }
        }

        return jsonResponse(request, { ok: true, service: { ...data, professional_ids: professional_ids ?? undefined } });
      },

      DELETE: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const { error } = await supabaseAdmin
          .from("services")
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
