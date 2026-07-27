// POST /api/public/extension/whatsapp/disconnect
//
// Hiberna a instância no provider (preserva credenciais no servidor da UAZAPI
// pra reconexão rápida) e marca `disconnected` localmente.

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

export const Route = createFileRoute("/api/public/extension/whatsapp/disconnect")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }

        const { data: inst } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("id, instance_id, instance_token, provider")
          .eq("barbershop_id", auth.token.barbershop_id)
          .maybeSingle();

        if (inst) {
          await supabaseAdmin
            .from("whatsapp_instances")
            .update({
              status: "disconnected",
              last_qr: null,
              last_synced_at: new Date().toISOString(),
            })
            .eq("id", inst.id);
        }

        if (inst?.instance_token) {
          try {
            const { getWhatsAppProviderByName } = await import("@/lib/whatsapp/provider.server");
            const provider = getWhatsAppProviderByName(inst.provider === "meta" ? "meta" : "uazapi");
            await provider.disconnect({
              instance_id: inst.instance_id ?? inst.instance_token,
              instance_token: inst.instance_token,
            });
          } catch (err) {
            console.warn("[whatsapp/disconnect] provider retornou erro (ignorado)", err);
          }

        }

        const { getWhatsAppProviderByName } = await import("@/lib/whatsapp/provider.server");
        const defaultProvider = getWhatsAppProviderByName("uazapi");
        return jsonResponse(request, {
          ok: true,
          connection: {
            status: "disconnected",
            phone: null,
            qrcode: null,
            provider: inst?.provider ?? defaultProvider.name,
            auth_mode: inst?.provider === "meta" ? "embedded_signup" : defaultProvider.authMode,
          },
        });

      },
    },
  },
});
