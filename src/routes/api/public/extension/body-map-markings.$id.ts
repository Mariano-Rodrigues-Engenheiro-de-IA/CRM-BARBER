// PATCH  /api/public/extension/body-map-markings/:id -> edita (ex: marcar como feito)
// DELETE /api/public/extension/body-map-markings/:id -> remove uma marcação errada

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const SELECT = "id, customer_id, view, region, procedure, notes, done, created_at";

const patchSchema = z.object({
  procedure: z.string().trim().min(1).max(120).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  done: z.boolean().optional(),
});

export const Route = createFileRoute("/api/public/extension/body-map-markings/$id")({
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
          .from("body_map_markings")
          .update(parsed.data)
          .eq("id", params.id)
          .eq("barbershop_id", shop)
          .select(SELECT)
          .maybeSingle();
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        if (!data) return jsonResponse(request, { ok: false, error: "Marcação não encontrada." }, { status: 404 });
        return jsonResponse(request, { ok: true, marking: data });
      },

      DELETE: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const shop = auth.token.barbershop_id;
        const { error } = await supabaseAdmin
          .from("body_map_markings")
          .delete()
          .eq("id", params.id)
          .eq("barbershop_id", shop);
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        return jsonResponse(request, { ok: true });
      },
    },
  },
});
