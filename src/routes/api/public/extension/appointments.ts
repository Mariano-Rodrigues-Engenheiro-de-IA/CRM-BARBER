// GET  /api/public/extension/appointments?from=ISO&to=ISO -> lista agendamentos no período
// POST /api/public/extension/appointments -> cria um agendamento novo

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const createSchema = z.object({
  title: z.string().trim().min(1).max(160),
  notes: z.string().trim().max(2000).optional(),
  customer_id: z.string().uuid().optional().nullable(),
  professional_id: z.string().uuid().optional().nullable(),
  service_id: z.string().uuid().optional().nullable(),
  scheduled_at: z.string().min(4).max(40),
  duration_minutes: z.number().int().min(5).max(480).optional(),
});

export const Route = createFileRoute("/api/public/extension/appointments")({
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
          .from("appointments")
          .select(
            "id, title, notes, customer_id, professional_id, service_id, scheduled_at, duration_minutes, status, customers(name, phone)",
          )
          .eq("barbershop_id", auth.token.barbershop_id)
          .neq("status", "canceled")
          .order("scheduled_at", { ascending: true });
        if (from) query = query.gte("scheduled_at", from);
        if (to) query = query.lt("scheduled_at", to);

        const { data, error } = await query;
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, appointments: data ?? [] });
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
          .from("appointments")
          .insert({
            barbershop_id: auth.token.barbershop_id,
            title: parsed.data.title,
            notes: parsed.data.notes ?? null,
            customer_id: parsed.data.customer_id ?? null,
            professional_id: parsed.data.professional_id ?? null,
            service_id: parsed.data.service_id ?? null,
            scheduled_at: parsed.data.scheduled_at,
            duration_minutes: parsed.data.duration_minutes ?? 30,
          })
          .select("id, title, notes, customer_id, professional_id, service_id, scheduled_at, duration_minutes, status")
          .single();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, appointment: data });
      },
    },
  },
});
