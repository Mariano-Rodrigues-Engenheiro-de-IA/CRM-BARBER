// GET    /api/public/extension/body-map-markings?customer_id=X -> lista
// POST   /api/public/extension/body-map-markings -> cria uma marcação
// DELETE via /api/public/extension/body-map-markings/:id (arquivo separado)

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const SELECT = "id, customer_id, view, region, procedure, notes, done, created_at";

const postSchema = z.object({
  customer_id: z.string().uuid(),
  view: z.enum(["front", "back"]),
  region: z.string().trim().min(1).max(60),
  procedure: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const Route = createFileRoute("/api/public/extension/body-map-markings")({
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
          .from("body_map_markings")
          .select(SELECT)
          .eq("barbershop_id", shop)
          .eq("customer_id", customerId)
          .order("created_at", { ascending: true });
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        return jsonResponse(request, { ok: true, markings: data ?? [] });
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
          .from("body_map_markings")
          .insert({
            barbershop_id: shop,
            customer_id: parsed.data.customer_id,
            view: parsed.data.view,
            region: parsed.data.region,
            procedure: parsed.data.procedure,
            notes: parsed.data.notes ?? null,
          })
          .select(SELECT)
          .single();
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        return jsonResponse(request, { ok: true, marking: data });
      },
    },
  },
});
