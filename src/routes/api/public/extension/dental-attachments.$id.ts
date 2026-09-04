// DELETE /api/public/extension/dental-attachments/:id -> remove o arquivo e o registro

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const BUCKET = "dental-attachments";

export const Route = createFileRoute("/api/public/extension/dental-attachments/$id")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      DELETE: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const shop = auth.token.barbershop_id;
        const { data: row } = await supabaseAdmin
          .from("dental_attachments")
          .select("file_path")
          .eq("id", params.id)
          .eq("barbershop_id", shop)
          .maybeSingle();
        if (!row) return jsonResponse(request, { ok: false, error: "Anexo não encontrado." }, { status: 404 });

        await supabaseAdmin.storage.from(BUCKET).remove([row.file_path]).catch(() => undefined);
        const { error } = await supabaseAdmin
          .from("dental_attachments")
          .delete()
          .eq("id", params.id)
          .eq("barbershop_id", shop);
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        return jsonResponse(request, { ok: true });
      },
    },
  },
});
