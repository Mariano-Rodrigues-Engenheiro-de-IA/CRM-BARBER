// GET /api/public/extension/agente-ia-settings -> link do vídeo de vendas
// (configurado pelo admin), visível pra qualquer cliente logado

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

export const Route = createFileRoute("/api/public/extension/agente-ia-settings")({
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
          .from("agente_ia_settings")
          .select("sales_video_url")
          .eq("id", true)
          .single();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, sales_video_url: data.sales_video_url });
      },
    },
  },
});
