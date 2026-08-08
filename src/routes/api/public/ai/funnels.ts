// GET /api/public/ai/funnels -> lista funis e etapas (kanbans), formato
// simplificado pensado para uma IA consumir e decidir para onde mover um
// lead. Autenticação: Bearer token (mesmo token usado pela extensão).

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

export const Route = createFileRoute("/api/public/ai/funnels")({
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

        const { data: funnels } = await supabaseAdmin
          .from("funnels")
          .select("id, name, sort_order")
          .eq("barbershop_id", shop)
          .order("sort_order", { ascending: true });

        const { data: stages } = await supabaseAdmin
          .from("funnel_stages")
          .select("id, funnel_id, name, sort_order")
          .eq("barbershop_id", shop)
          .order("sort_order", { ascending: true });

        const result = (funnels ?? []).map((f) => ({
          id: f.id,
          name: f.name,
          stages: (stages ?? [])
            .filter((s) => s.funnel_id === f.id)
            .map((s) => ({ id: s.id, name: s.name })),
        }));

        return jsonResponse(request, { ok: true, funnels: result });
      },
    },
  },
});
