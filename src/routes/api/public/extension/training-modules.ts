// GET /api/public/extension/training-modules -> lista módulos ativos
// (conteúdo global, mesmo para todos os clientes do CRM)

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

export const Route = createFileRoute("/api/public/extension/training-modules")({
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
          .from("training_modules")
          .select("id, title, description, cover_image_url, sort_order")
          .eq("active", true)
          .order("sort_order", { ascending: true });
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, modules: data ?? [] });
      },
    },
  },
});
