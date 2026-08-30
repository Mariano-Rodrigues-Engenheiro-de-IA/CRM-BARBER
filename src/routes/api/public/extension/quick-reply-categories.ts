// GET  /api/public/extension/quick-reply-categories -> lista categorias da barbearia
// POST /api/public/extension/quick-reply-categories -> cria uma categoria
//
// Categoria é criada ANTES, separadamente — depois é só escolhida (por id)
// na hora de criar/editar uma resposta rápida. Ver quick-replies.ts.

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { quickReplyCategorySchema } from "@/lib/quick-replies";

export const Route = createFileRoute("/api/public/extension/quick-reply-categories")({
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
          .from("quick_reply_categories")
          .select("id, name, color, sort_order")
          .eq("barbershop_id", auth.token.barbershop_id)
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true });
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, categories: data ?? [] });
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
        const parsed = quickReplyCategorySchema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(
            request,
            { ok: false, error: "Dados inválidos", details: parsed.error.flatten() },
            { status: 400 },
          );
        }
        const { data, error } = await supabaseAdmin
          .from("quick_reply_categories")
          .insert({
            barbershop_id: auth.token.barbershop_id,
            name: parsed.data.name,
            color: parsed.data.color ?? "#3d5fa8",
            sort_order: parsed.data.sort_order ?? 0,
          })
          .select("id, name, color, sort_order")
          .single();
        if (error) {
          // Código 23505 = já existe uma categoria com esse nome (índice
          // único por barbearia, sem diferenciar maiúsculas/minúsculas).
          if (error.code === "23505") {
            return jsonResponse(request, { ok: false, error: "Já existe uma categoria com esse nome." }, { status: 409 });
          }
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, category: data });
      },
    },
  },
});
