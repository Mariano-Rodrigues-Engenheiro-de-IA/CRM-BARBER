// PATCH  /api/public/extension/professionals/:id -> edita
// DELETE /api/public/extension/professionals/:id -> exclui de verdade (o
// empresário já foi avisado do impacto na tela antes de chamar isso)

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(20).optional().nullable(),
  email: z.string().trim().email().max(160).optional().nullable(),
  bio: z.string().trim().max(500).optional().nullable(),
  commission_percent: z.number().min(0).max(100).optional().nullable(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  avatar_url: z.string().max(400000).optional().nullable(),
  active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

export const Route = createFileRoute("/api/public/extension/professionals/$id")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      PATCH: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
        }
        const { data, error } = await supabaseAdmin
          .from("professionals")
          .update(parsed.data)
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id)
          .select("id, name, phone, email, bio, commission_percent, color, avatar_url, active, sort_order")
          .maybeSingle();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        if (!data) return jsonResponse(request, { ok: false, error: "Not found" }, { status: 404 });
        return jsonResponse(request, { ok: true, professional: data });
      },

      DELETE: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const shop = auth.token.barbershop_id;

        // A decisão de excluir é do empresário — ele já foi avisado na
        // tela (aviso simples, ou aviso de impacto se houver histórico)
        // antes de chegar aqui. Exclui de verdade, sem bloqueio
        // automático. Agendamentos vinculados são excluídos junto (não
        // "SET NULL" — o profissional some da agenda por completo).
        await supabaseAdmin.from("appointments").delete().eq("barbershop_id", shop).eq("professional_id", params.id);
        await supabaseAdmin.from("professional_services").delete().eq("professional_id", params.id);
        await supabaseAdmin.from("time_blocks").delete().eq("professional_id", params.id).eq("barbershop_id", shop);

        const { error } = await supabaseAdmin
          .from("professionals")
          .delete()
          .eq("id", params.id)
          .eq("barbershop_id", shop);
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true });
      },
    },
  },
});
