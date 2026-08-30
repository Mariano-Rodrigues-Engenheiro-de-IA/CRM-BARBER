// PATCH  /api/public/extension/quick-replies/:id -> atualiza título/ações
// DELETE /api/public/extension/quick-replies/:id -> remove a resposta rápida

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { quickReplySchema } from "@/lib/quick-replies";

const patchSchema = quickReplySchema.partial();

export const Route = createFileRoute("/api/public/extension/quick-replies/$id")({
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
            { ok: false, error: "Dados inválidos", details: parsed.error.flatten() },
            { status: 400 },
          );
        }
        const { data, error } = await supabaseAdmin
          .from("quick_replies")
          .update(parsed.data)
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id)
          .select("id, title, actions, sort_order, category, shortcut, is_favorite")
          .maybeSingle();
        if (error) {
          if (error.code === "23505") {
            return jsonResponse(request, { ok: false, error: "Esse atalho já está em uso por outra resposta." }, { status: 409 });
          }
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        if (!data) return jsonResponse(request, { ok: false, error: "Not found" }, { status: 404 });
        return jsonResponse(request, { ok: true, quick_reply: data });
      },

      DELETE: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const { error } = await supabaseAdmin
          .from("quick_replies")
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
