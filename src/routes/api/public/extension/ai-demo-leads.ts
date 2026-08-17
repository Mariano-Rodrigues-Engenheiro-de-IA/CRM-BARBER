// POST /api/public/extension/ai-demo-leads -> cliente logado agenda uma
// demonstração do Agente de IA (formulário na página de vendas)

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const leadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(8).max(25),
  segment: z.string().trim().max(120).optional(),
  revenue_range: z.string().trim().max(60).optional(),
  goal: z.enum(["vendas", "agendamento", "ambos"]).optional(),
});

export const Route = createFileRoute("/api/public/extension/ai-demo-leads")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const parsed = leadSchema.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
        }
        const { error } = await supabaseAdmin.from("ai_demo_leads").insert({
          barbershop_id: auth.token.barbershop_id,
          name: parsed.data.name,
          phone: parsed.data.phone,
          segment: parsed.data.segment || null,
          revenue_range: parsed.data.revenue_range || null,
          goal: parsed.data.goal || null,
        });
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true });
      },
    },
  },
});
