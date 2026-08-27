// GET  /api/public/extension/services -> lista (ativos por padrão), com professional_ids vinculados
// POST /api/public/extension/services -> cria, aceita professional_ids opcional

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().max(60).optional(),
  description: z.string().trim().max(500).optional(),
  duration_minutes: z.number().int().min(5).max(480).default(30),
  price: z.number().min(0).max(1000000).optional(),
  // Quais profissionais realizam esse serviço. Se omitido/vazio, o
  // serviço fica disponível para TODOS os profissionais (sem restrição).
  professional_ids: z.array(z.string().uuid()).optional(),
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
          .select("id, name, category, description, duration_minutes, price, active, sort_order")
          .eq("barbershop_id", auth.token.barbershop_id)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });
        if (!includeInactive) query = query.eq("active", true);
        const { data, error } = await query;
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        const services = data ?? [];
        // Busca todos os vínculos de uma vez (evita N+1) e agrupa por serviço.
        const { data: links } = await supabaseAdmin
          .from("professional_services")
          .select("service_id, professional_id")
          .in("service_id", services.map((s) => s.id));
        const linksByService = new Map<string, string[]>();
        for (const l of links ?? []) {
          const arr = linksByService.get(l.service_id) ?? [];
          arr.push(l.professional_id);
          linksByService.set(l.service_id, arr);
        }
        const withLinks = services.map((s) => ({ ...s, professional_ids: linksByService.get(s.id) ?? [] }));
        return jsonResponse(request, { ok: true, services: withLinks });
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
        const { professional_ids, ...serviceFields } = parsed.data;
        const { data, error } = await supabaseAdmin
          .from("services")
          .insert({ barbershop_id: auth.token.barbershop_id, ...serviceFields })
          .select("id, name, category, description, duration_minutes, price, active, sort_order")
          .single();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        if (professional_ids && professional_ids.length > 0) {
          const { error: linkErr } = await supabaseAdmin
            .from("professional_services")
            .insert(professional_ids.map((pid) => ({ service_id: data.id, professional_id: pid })));
          if (linkErr) {
            return jsonResponse(request, { ok: false, error: `Serviço criado, mas falhou ao vincular profissionais: ${linkErr.message}` }, { status: 500 });
          }
        }
        return jsonResponse(request, { ok: true, service: { ...data, professional_ids: professional_ids ?? [] } });
      },
    },
  },
});
