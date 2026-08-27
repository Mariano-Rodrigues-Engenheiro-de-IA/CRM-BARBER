// GET  /api/public/extension/professionals -> lista (ativos por padrão)
// POST /api/public/extension/professionals -> cria

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().email().max(160).optional().or(z.literal("")),
  bio: z.string().trim().max(500).optional(),
  commission_percent: z.number().min(0).max(100).optional(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  // Foto do profissional guardada como data URL (o cliente já redimensiona
  // pra um quadrado pequeno antes de enviar).
  avatar_url: z.string().max(400000).optional().nullable(),
});

export const Route = createFileRoute("/api/public/extension/professionals")({
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
          .from("professionals")
          .select("id, name, phone, email, bio, commission_percent, color, avatar_url, active, sort_order")
          .eq("barbershop_id", auth.token.barbershop_id)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });
        if (!includeInactive) query = query.eq("active", true);
        const { data, error } = await query;
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        const professionals = data ?? [];
        // Conta agendamentos de cada um, pra decidir na hora de excluir se
        // mostra o aviso simples ou o aviso de impacto (sem bloquear).
        const counts = await Promise.all(
          professionals.map((p) =>
            supabaseAdmin
              .from("appointments")
              .select("id", { count: "exact", head: true })
              .eq("barbershop_id", auth.token.barbershop_id)
              .eq("professional_id", p.id)
              .then((r) => [p.id, r.count ?? 0] as const),
          ),
        );
        const countMap = new Map(counts);
        return jsonResponse(request, {
          ok: true,
          professionals: professionals.map((p) => ({ ...p, appointment_count: countMap.get(p.id) ?? 0 })),
        });
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
          .from("professionals")
          .insert({ barbershop_id: auth.token.barbershop_id, ...parsed.data })
          .select("id, name, phone, email, bio, commission_percent, color, avatar_url, active, sort_order")
          .single();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, professional: data });
      },
    },
  },
});
