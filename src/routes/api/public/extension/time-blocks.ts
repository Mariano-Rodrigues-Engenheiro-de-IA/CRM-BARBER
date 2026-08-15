// GET    /api/public/extension/time-blocks?from=&to= -> lista bloqueios no periodo
// POST   /api/public/extension/time-blocks -> cria bloqueio (unico ou recorrente)

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const createSchema = z.object({
  professional_id: z.string().uuid().optional().nullable(),
  starts_at: z.string().min(4).max(40),
  ends_at: z.string().min(4).max(40),
  reason: z.string().trim().max(200).optional(),
  // Recorrência: repete o MESMO horário (starts_at/ends_at) a cada
  // `periodicity_days` dias, por `count_days` ocorrências no total
  // (incluindo a primeira). Ex: todo dia (periodicity_days=1) por 30
  // ocorrências = bloqueia o mesmo horário nos próximos 30 dias.
  recurrence: z
    .object({
      count_days: z.number().int().min(1).max(180),
      periodicity_days: z.number().int().min(1).max(30),
    })
    .optional(),
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
        const startsAt = new Date(parsed.data.starts_at);
        const endsAt = new Date(parsed.data.ends_at);
        if (endsAt <= startsAt) {
          return jsonResponse(request, { ok: false, error: "O horário final precisa ser depois do inicial." }, { status: 400 });
        }

        const count = parsed.data.recurrence?.count_days ?? 1;
        const periodicity = parsed.data.recurrence?.periodicity_days ?? 1;
        const durationMs = endsAt.getTime() - startsAt.getTime();
        const rows = Array.from({ length: count }, (_, i) => {
          const occurrenceStart = new Date(startsAt.getTime() + i * periodicity * 86400000);
          const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);
          return {
            barbershop_id: auth.token.barbershop_id,
            professional_id: parsed.data.professional_id ?? null,
            starts_at: occurrenceStart.toISOString(),
            ends_at: occurrenceEnd.toISOString(),
            reason: parsed.data.reason ?? null,
          };
        });

        const { data, error } = await supabaseAdmin
          .from("time_blocks")
          .insert(rows)
          .select("id, professional_id, starts_at, ends_at, reason");
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, time_blocks: data, created_count: data?.length ?? 0 });
      },
    },
  },
});
