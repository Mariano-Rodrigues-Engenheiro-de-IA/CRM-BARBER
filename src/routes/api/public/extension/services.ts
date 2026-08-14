// GET  /api/public/extension/services -> lista (ativos por padrão)
// POST /api/public/extension/services -> cria

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  duration_minutes: z.number().int().min(5).max(480).default(30),
  price: z.number().min(0).max(1000000).optional(),
});

export const Route = createFileRoute("/api/public/extension/services")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const url = new URL(request.url);
        const includeInactive = url.searchParams.get("include_inactive") === "1";
        let query = supabaseAdmin
          .from("services")
          .select("id, name, duration_minutes, price, active, sort_order")
          .eq("barbershop_id", auth.token.barbershop_id)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });
        if (!includeInactive) query = query.eq("active", true);
        const { data, error } = await query;
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, services: data ?? [] });
      },

      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
        }
        const { data, error } = await supabaseAdmin
          .from("services")
          .insert({ barbershop_id: auth.token.barbershop_id, ...parsed.data })
          .select("id, name, duration_minutes, price, active, sort_order")
          .single();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, service: data });
      },
    },
  },
});
