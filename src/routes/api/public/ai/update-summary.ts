// POST /api/public/ai/update-summary -> atualiza o resumo (gerado pela IA)
// de um cliente, pelo telefone. Separado da anotação manual do vendedor —
// campo próprio (ai_summary), pensado para o agente de IA manter
// sincronizado automaticamente durante a conversa.
// Autenticação: Bearer token (mesmo token usado pela extensão/move-lead).
//
// Body: { phone: string, summary: string }

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const bodySchema = z.object({
  phone: z.string().min(8).max(20),
  summary: z.string().trim().min(1).max(1200),
});

export const Route = createFileRoute("/api/public/ai/update-summary")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const shop = auth.token.barbershop_id;

        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return jsonResponse(request, { ok: false, error: "JSON inválido" }, { status: 400 });
        }
        const parsed = bodySchema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(
            request,
            { ok: false, error: "Dados inválidos", details: parsed.error.flatten() },
            { status: 400 },
          );
        }
        const { phone, summary } = parsed.data;
        const digits = phone.replace(/\D/g, "");

        const { data: customer } = await supabaseAdmin
          .from("customers")
          .select("id")
          .eq("barbershop_id", shop)
          .eq("phone", digits)
          .maybeSingle();

        if (!customer) {
          // Cliente ainda não existe no CRM — não é erro, a IA pode estar
          // conversando com alguém que ainda não virou lead por aqui.
          return jsonResponse(request, { ok: true, skipped: "customer_not_found" });
        }

        const { error } = await supabaseAdmin
          .from("customers")
          .update({ ai_summary: summary, ai_summary_updated_at: new Date().toISOString() })
          .eq("id", customer.id);
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }

        return jsonResponse(request, { ok: true });
      },
    },
  },
});
