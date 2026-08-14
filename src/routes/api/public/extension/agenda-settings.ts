// GET   /api/public/extension/agenda-settings -> busca config (cria padrão se não existir)
// PATCH /api/public/extension/agenda-settings -> atualiza slot_duration_minutes e/ou business_hours

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const dayHours = z.object({
  closed: z.boolean(),
  open: z.string().optional(),
  close: z.string().optional(),
});
const patchSchema = z.object({
  slot_duration_minutes: z.number().int().min(5).max(120).optional(),
  business_hours: z.record(z.string(), dayHours).optional(),
});

export const Route = createFileRoute("/api/public/extension/agenda-settings")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const { data: existing } = await supabaseAdmin
          .from("agenda_settings")
          .select("barbershop_id, slot_duration_minutes, business_hours")
          .eq("barbershop_id", auth.token.barbershop_id)
          .maybeSingle();
        if (existing) {
          return jsonResponse(request, { ok: true, settings: existing });
        }
        // Cria com os padrões da migration na primeira consulta.
        const { data: created, error } = await supabaseAdmin
          .from("agenda_settings")
          .insert({ barbershop_id: auth.token.barbershop_id })
          .select("barbershop_id, slot_duration_minutes, business_hours")
          .single();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, settings: created });
      },

      PATCH: async ({ request }) => {
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
          .from("agenda_settings")
          .upsert({ barbershop_id: auth.token.barbershop_id, ...parsed.data }, { onConflict: "barbershop_id" })
          .select("barbershop_id, slot_duration_minutes, business_hours")
          .single();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, settings: data });
      },
    },
  },
});
