// GET /api/public/extension/wa/data
// Devolve as etiquetas e contatos sincronizados da barbearia.

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

export const Route = createFileRoute("/api/public/extension/wa/data")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const shop = auth.token.barbershop_id;

        const [labels, contacts] = await Promise.all([
          supabaseAdmin
            .from("wa_labels")
            .select("id, wa_label_id, name, color, conversation_count")
            .eq("barbershop_id", shop)
            .order("name", { ascending: true }),
          supabaseAdmin
            .from("wa_contacts")
            .select("id, wa_id, phone, name, is_group, label_ids, last_message_at")
            .eq("barbershop_id", shop)
            .order("last_message_at", { ascending: false, nullsFirst: false })
            .limit(2000),
        ]);

        const error = labels.error || contacts.error;
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, {
          ok: true,
          labels: labels.data ?? [],
          contacts: contacts.data ?? [],
        });
      },
    },
  },
});
