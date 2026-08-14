// GET    /api/public/extension/time-blocks?from=&to= -> lista bloqueios no periodo
// POST   /api/public/extension/time-blocks -> cria bloqueio

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const createSchema = z.object({
  professional_id: z.string().uuid().optional().nullable(),
  starts_at: z.string().min(4).max(40),
  ends_at: z.string().min(4).max(40),
  reason: z.string().trim().max(200).optional(),
});

export const Route = createFileRoute("/api/public/extension/time-blocks")({
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
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        let query = supabaseAdmin
          .from("time_blocks")
          .select("id, professional_id, starts_at, ends_at, reason")
          .eq("barbershop_id", auth.token.barbershop_id)
          .order("starts_at", { ascending: true });
        if (from) query = query.gte("ends_at", from);
        if (to) query = query.lt("starts_at", to);
        const { data, error } = await query;
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, time_blocks: data ?? [] });
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
        if (new Date(parsed.data.ends_at) <= new Date(parsed.data.starts_at)) {
          return jsonResponse(request, { ok: false, error: "O horário final precisa ser depois do inicial." }, { status: 400 });
        }
        const { data, error } = await supabaseAdmin
          .from("time_blocks")
          .insert({
            barbershop_id: auth.token.barbershop_id,
            professional_id: parsed.data.professional_id ?? null,
            starts_at: parsed.data.starts_at,
            ends_at: parsed.data.ends_at,
            reason: parsed.data.reason ?? null,
          })
          .select("id, professional_id, starts_at, ends_at, reason")
          .single();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, time_block: data });
      },
    },
  },
});
