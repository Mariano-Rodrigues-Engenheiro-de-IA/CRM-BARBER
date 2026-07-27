// POST /api/public/extension/whatsapp/provider
//
// Define o modo de conexão WhatsApp por barbearia autenticada pelo token da
// extensão. Isso permite misturar clientes no QR/não oficial e na API oficial.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const bodySchema = z.object({
  provider: z.enum(["uazapi", "meta"]),
});

export const Route = createFileRoute("/api/public/extension/whatsapp/provider")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }

        let parsed: z.infer<typeof bodySchema>;
        try {
          parsed = bodySchema.parse(await request.json());
        } catch {
          return jsonResponse(request, { ok: false, error: "Provider inválido" }, { status: 400 });
        }

        const { setProviderMode } = await import("@/lib/admin-whatsapp.server");
        await setProviderMode(supabaseAdmin, {
          barbershop_id: auth.token.barbershop_id,
          provider: parsed.provider,
        });

        const { getWhatsAppProviderByName } = await import("@/lib/whatsapp/provider.server");
        const provider = getWhatsAppProviderByName(parsed.provider);

        return jsonResponse(request, {
          ok: true,
          connection: {
            status: "disconnected",
            phone: null,
            qrcode: null,
            provider: provider.name,
            auth_mode: provider.authMode,
          },
        });
      },
    },
  },
});