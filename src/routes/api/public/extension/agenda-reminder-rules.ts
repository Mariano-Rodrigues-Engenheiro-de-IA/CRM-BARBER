// GET  /api/public/extension/agenda-reminder-rules -> lista as regras
// POST /api/public/extension/agenda-reminder-rules -> cria uma regra
//
// Ver src/lib/agenda-reminders.ts pra entender "reminder" vs "confirmation".

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { agendaReminderRuleSchema } from "@/lib/agenda-reminders";

const SELECT_COLS =
  "id, name, kind, offset_minutes, applies_to_statuses, message_text, template_name, template_language, confirm_button_text, active";

export const Route = createFileRoute("/api/public/extension/agenda-reminder-rules")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const { data, error } = await supabaseAdmin
          .from("agenda_reminder_rules")
          .select(SELECT_COLS)
          .eq("barbershop_id", auth.token.barbershop_id)
          .order("offset_minutes", { ascending: true });
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, rules: data ?? [] });
      },

      POST: async ({ request }) => {
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
        const parsed = agendaReminderRuleSchema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(
            request,
            { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
            { status: 400 },
          );
        }
        const { data, error } = await supabaseAdmin
          .from("agenda_reminder_rules")
          .insert({
            barbershop_id: auth.token.barbershop_id,
            name: parsed.data.name,
            kind: parsed.data.kind,
            offset_minutes: parsed.data.offset_minutes,
            applies_to_statuses: parsed.data.applies_to_statuses,
            message_text: parsed.data.message_text ?? null,
            template_name: parsed.data.template_name ?? null,
            template_language: parsed.data.template_language ?? null,
            confirm_button_text: parsed.data.confirm_button_text ?? null,
            active: parsed.data.active ?? true,
          })
          .select(SELECT_COLS)
          .single();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, rule: data });
      },
    },
  },
});
