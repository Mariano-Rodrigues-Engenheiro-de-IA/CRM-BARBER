// GET  /api/public/extension/quick-replies -> lista respostas rápidas da barbearia
// POST /api/public/extension/quick-replies -> cria uma resposta rápida
//
// Tenant sempre vem do token da extensão.

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { quickReplySchema, QUICK_REPLY_BUCKET, type QuickReplyAction } from "@/lib/quick-replies";
import type { SupabaseClient } from "@supabase/supabase-js";

// 12h: o painel pode ficar aberto o dia inteiro e a mídia só é baixada na
// hora do envio — 1h fazia o link expirar antes do disparo.
const SIGNED_URL_TTL = 12 * 60 * 60;

/** Troca `path` por URL assinada para o WhatsApp Web conseguir baixar a mídia. */
export async function withSignedUrls(
  supabaseAdmin: SupabaseClient<never>,
  actions: QuickReplyAction[],
): Promise<QuickReplyAction[]> {
  const paths = actions.map((a) => a.path).filter((p): p is string => !!p);
  if (paths.length === 0) return actions;
  const { data } = await supabaseAdmin.storage
    .from(QUICK_REPLY_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL);
  const byPath = new Map((data ?? []).map((d) => [d.path ?? "", d.signedUrl]));
  return actions.map((a) => (a.path ? { ...a, url: byPath.get(a.path) ?? null } : a));
}

export const Route = createFileRoute("/api/public/extension/quick-replies")({
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
          .from("quick_replies")
          .select("id, title, actions, sort_order")
          .eq("barbershop_id", auth.token.barbershop_id)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        const admin = supabaseAdmin as unknown as SupabaseClient<never>;
        const replies = await Promise.all(
          (data ?? []).map(async (row) => ({
            ...row,
            actions: await withSignedUrls(admin, (row.actions as QuickReplyAction[]) ?? []),
          })),
        );
        return jsonResponse(request, { ok: true, quick_replies: replies });
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
        const parsed = quickReplySchema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(
            request,
            { ok: false, error: "Dados inválidos", details: parsed.error.flatten() },
            { status: 400 },
          );
        }
        const { data, error } = await supabaseAdmin
          .from("quick_replies")
          .insert({
            barbershop_id: auth.token.barbershop_id,
            title: parsed.data.title,
            actions: parsed.data.actions,
            sort_order: parsed.data.sort_order ?? 0,
          })
          .select("id, title, actions, sort_order")
          .single();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, quick_reply: data });
      },
    },
  },
});
