// PATCH /api/public/extension/campaigns/saved/:id -> edita uma
// campanha salva (título, texto, imagem). Se ela já tinha sido enviada
// pra aprovação (pending_approval/approved) numa instância oficial,
// volta pro status 'draft' — editar sem reenviar deixaria o texto
// dessincronizado do que a Meta aprovou.
// DELETE -> remove.

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

export const Route = createFileRoute("/api/public/extension/campaigns/saved/$id")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      PATCH: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }

        const { data: existing } = await supabaseAdmin
          .from("saved_campaigns")
          .select("id, status")
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id)
          .maybeSingle();
        if (!existing) {
          return jsonResponse(
            request,
            { ok: false, error: "Campanha não encontrada." },
            { status: 404 },
          );
        }

        let body: Record<string, unknown>;
        try {
          body = await request.json();
        } catch {
          return jsonResponse(request, { ok: false, error: "JSON inválido." }, { status: 400 });
        }

        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim();
        if (typeof body.body_text === "string" && body.body_text.trim())
          patch.body_text = body.body_text.trim();
        if (typeof body.image_path === "string") patch.image_path = body.image_path || null;
        if (typeof body.audio_path === "string") patch.audio_path = body.audio_path || null;

        // Editar um modelo já enviado/aprovado na Meta invalida o que foi
        // aprovado — volta pra rascunho, precisa reenviar pra aprovação.
        if (existing.status === "pending_approval" || existing.status === "approved") {
          patch.status = "draft";
          patch.rejection_reason = null;
          patch.whatsapp_template_name = null;
        }

        const { data: updated, error } = await supabaseAdmin
          .from("saved_campaigns")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update(patch as any)
          .eq("id", params.id)
          .select(
            "id, catalog_campaign_id, title, body_text, image_path, audio_path, status, rejection_reason, whatsapp_template_name, created_at",
          )
          .single();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, campaign: updated });
      },

      DELETE: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const { error } = await supabaseAdmin
          .from("saved_campaigns")
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
