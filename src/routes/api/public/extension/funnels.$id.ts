// PATCH  /api/public/extension/funnels/:id -> renomeia funil e edita colunas
// DELETE /api/public/extension/funnels/:id -> remove funil (colunas/cards em cascata)

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { funnelPatchSchema } from "@/lib/funnels";

export const Route = createFileRoute("/api/public/extension/funnels/$id")({
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
        const parsed = funnelPatchSchema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: "Dados inválidos" }, { status: 400 });
        }
        const shop = auth.token.barbershop_id;

        // Tenant sempre do token: o id da URL só vale dentro da barbearia dele.
        const { data: funnel } = await supabaseAdmin
          .from("funnels")
          .select("id")
          .eq("id", params.id)
          .eq("barbershop_id", shop)
          .maybeSingle();
        if (!funnel) {
          return jsonResponse(request, { ok: false, error: "Funil não encontrado" }, { status: 404 });
        }

        const patch: { name?: string; source_label_id?: string | null; sort_order?: number } = {};
        if (parsed.data.name !== undefined) patch.name = parsed.data.name;
        if (parsed.data.source_label_id !== undefined) patch.source_label_id = parsed.data.source_label_id;
        if (parsed.data.sort_order !== undefined) patch.sort_order = parsed.data.sort_order;
        if (Object.keys(patch).length) {
          const { error } = await supabaseAdmin
            .from("funnels")
            .update(patch)
            .eq("id", params.id)
            .eq("barbershop_id", shop);
          if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }

        for (const id of parsed.data.removed_stage_ids ?? []) {
          await supabaseAdmin
            .from("funnel_stages")
            .delete()
            .eq("id", id)
            .eq("funnel_id", params.id)
            .eq("barbershop_id", shop);
        }

        for (const stage of parsed.data.stages ?? []) {
          const stageData = { name: stage.name, color: stage.color ?? null, sort_order: stage.sort_order };
          if (stage.id) {
            const { error } = await supabaseAdmin
              .from("funnel_stages")
              .update(stageData)
              .eq("id", stage.id)
              .eq("funnel_id", params.id)
              .eq("barbershop_id", shop);
            
            // Se falhar por causa da coluna color, tenta sem ela
            if (error?.message?.includes("color")) {
              await supabaseAdmin
                .from("funnel_stages")
                .update({ name: stage.name, sort_order: stage.sort_order })
                .eq("id", stage.id)
                .eq("funnel_id", params.id)
                .eq("barbershop_id", shop);
            }
          } else {
            const { error } = await supabaseAdmin.from("funnel_stages").insert({
              barbershop_id: shop,
              funnel_id: params.id,
              ...stageData,
            });

            // Se falhar por causa da coluna color, tenta sem ela
            if (error?.message?.includes("color")) {
              await supabaseAdmin.from("funnel_stages").insert({
                barbershop_id: shop,
                funnel_id: params.id,
                name: stage.name,
                sort_order: stage.sort_order,
              });
            }
          }
        }

        return jsonResponse(request, { ok: true });
      },

      DELETE: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const { error } = await supabaseAdmin
          .from("funnels")
          .delete()
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id);
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        return jsonResponse(request, { ok: true });
      },
    },
  },
});
