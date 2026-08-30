// PATCH  /api/public/extension/quick-reply-categories/:id -> renomeia/muda cor
// DELETE /api/public/extension/quick-reply-categories/:id -> apaga a categoria
//
// Apagar uma categoria NÃO apaga as respostas rápidas dela — elas ficam
// "sem categoria" (category_id vira NULL via ON DELETE SET NULL no banco).

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { quickReplyCategorySchema } from "@/lib/quick-replies";

const patchSchema = quickReplyCategorySchema.partial();

export const Route = createFileRoute("/api/public/extension/quick-reply-categories/$id")({
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
          .from("quick_reply_categories")
          .update(parsed.data)
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id)
          .select("id, name, color, sort_order")
          .maybeSingle();
        if (error) {
          if (error.code === "23505") {
            return jsonResponse(request, { ok: false, error: "Já existe uma categoria com esse nome." }, { status: 409 });
          }
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        if (!data) return jsonResponse(request, { ok: false, error: "Not found" }, { status: 404 });
        return jsonResponse(request, { ok: true, category: data });
      },

      DELETE: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const { error } = await supabaseAdmin
          .from("quick_reply_categories")
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
