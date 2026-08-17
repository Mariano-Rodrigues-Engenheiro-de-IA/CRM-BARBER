// POST /api/public/ai/set-access -> chamado pelo IA-BARBER-AGENDA (via a
// ponte protegida por chave secreta compartilhada) quando o admin vincula
// ou desvincula um tenant a uma barbearia deste CRM.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const bodySchema = z.object({
  barbershop_id: z.string().uuid(),
  enabled: z.boolean(),
});

export const Route = createFileRoute("/api/public/ai/set-access")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const bridgeSecret = process.env.CRM_BRIDGE_SHARED_SECRET;
        if (!bridgeSecret || request.headers.get("x-shared-secret") !== bridgeSecret) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) {
          return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin
          .from("barbershops")
          .update({ ai_access_enabled: parsed.data.enabled })
          .eq("id", parsed.data.barbershop_id);
        if (error) {
          return Response.json({ error: error.message }, { status: 500 });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
