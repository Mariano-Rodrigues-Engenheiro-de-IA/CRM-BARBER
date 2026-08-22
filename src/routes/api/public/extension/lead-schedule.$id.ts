// PATCH  /api/public/extension/lead-schedule/:id -> edita uma mensagem agendada (só se ainda pendente)
// DELETE /api/public/extension/lead-schedule/:id -> cancela um agendamento (só se ainda pendente)

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { quickReplyActionSchema, type QuickReplyAction } from "@/lib/quick-replies";

const patchSchema = z.object({
  message: z.string().trim().max(4000).optional(),
  actions: z.array(quickReplyActionSchema).min(1).max(10).optional(),
  scheduled_for: z.string().min(4).max(40).optional(),
});

export const Route = createFileRoute("/api/public/extension/lead-schedule/$id")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      PATCH: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return jsonResponse(request, { ok: false, error: "Invalid JSON" }, { status: 400 });
        }
        const parsed = patchSchema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
        }
        const patch: { rendered_body?: string; message_actions?: QuickReplyAction[]; scheduled_for?: string; expires_at?: string } = {};
        if (parsed.data.actions?.length) {
          patch.message_actions = parsed.data.actions;
          const firstText = parsed.data.actions.find((a) => a.type === "text")?.text;
          patch.rendered_body = (parsed.data.message?.trim() || firstText || "[Mídia]").slice(0, 4000);
        } else if (parsed.data.message) {
          patch.rendered_body = parsed.data.message.trim();
          patch.message_actions = [{ type: "text", text: parsed.data.message.trim() }];
        }
        if (parsed.data.scheduled_for) {
          const when = Date.parse(parsed.data.scheduled_for);
          if (Number.isNaN(when)) return jsonResponse(request, { ok: false, error: "Data inválida" }, { status: 400 });
          patch.scheduled_for = new Date(when).toISOString();
          patch.expires_at = new Date(when + 48 * 3600 * 1000).toISOString();
        }
        if (!Object.keys(patch).length) return jsonResponse(request, { ok: true });

        const { data, error } = await supabaseAdmin
          .from("message_jobs")
          .update(patch)
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id)
          .eq("status", "pending")
          .select("id, rendered_body, message_actions, scheduled_for, status")
          .maybeSingle();
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        if (!data) return jsonResponse(request, { ok: false, error: "Não é mais possível editar (já foi enviada ou cancelada)" }, { status: 409 });
        return jsonResponse(request, { ok: true, job: data });
      },

      DELETE: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const { error } = await supabaseAdmin
          .from("message_jobs")
          .delete()
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id)
          .eq("status", "pending");
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        return jsonResponse(request, { ok: true });
      },
    },
  },
});
