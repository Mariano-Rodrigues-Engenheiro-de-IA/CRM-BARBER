// PATCH  /api/public/extension/agenda-reminder-rules/:id -> edita a regra
// DELETE /api/public/extension/agenda-reminder-rules/:id -> apaga

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { agendaReminderRuleBaseSchema } from "@/lib/agenda-reminders";

const SELECT_COLS =
  "id, name, kind, offset_minutes, applies_to_statuses, message_text, template_name, template_language, template_header_media_path, confirm_button_text, confirm_keywords, active";

const patchSchema = agendaReminderRuleBaseSchema.partial();

export const Route = createFileRoute("/api/public/extension/agenda-reminder-rules/$id")({
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
          return jsonResponse(
            request,
            { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
            { status: 400 },
          );
        }
        const { data, error } = await supabaseAdmin
          .from("agenda_reminder_rules")
          .update(parsed.data)
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id)
          .select(SELECT_COLS)
          .maybeSingle();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        if (!data) return jsonResponse(request, { ok: false, error: "Not found" }, { status: 404 });
        return jsonResponse(request, { ok: true, rule: data });
      },

      DELETE: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const { error } = await supabaseAdmin
          .from("agenda_reminder_rules")
          .delete()
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id);
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true });
      },
    },
  },
});
