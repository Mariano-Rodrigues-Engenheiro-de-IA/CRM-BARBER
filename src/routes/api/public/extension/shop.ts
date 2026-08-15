// GET   /api/public/extension/shop -> dados da barbearia (aba "Minha conta")
// PATCH /api/public/extension/shop -> atualiza nome, logo e dados do responsável

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const SELECT = "id, name, logo_url, owner_name, owner_email, owner_phone";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  logo_url: z.string().trim().max(600).nullable().optional(),
  owner_name: z.string().trim().max(120).nullable().optional(),
  owner_email: z.string().trim().max(160).nullable().optional(),
  owner_phone: z.string().trim().max(30).nullable().optional(),
});

export const Route = createFileRoute("/api/public/extension/shop")({
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
          .from("barbershops")
          .select(SELECT)
          .eq("id", auth.token.barbershop_id)
          .maybeSingle();
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        return jsonResponse(request, { ok: true, shop: data });
      },

      PATCH: async ({ request }) => {
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
          .from("barbershops")
          .update(parsed.data)
          .eq("id", auth.token.barbershop_id)
          .select(SELECT)
          .maybeSingle();
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        return jsonResponse(request, { ok: true, shop: data });
      },
    },
  },
});
