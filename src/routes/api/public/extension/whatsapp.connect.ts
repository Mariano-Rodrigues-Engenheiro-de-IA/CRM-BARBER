// POST /api/public/extension/whatsapp/connect
//
// Cria (ou reaproveita) a instância WhatsApp da barbearia e devolve o
// QR code inicial. Após isso, o painel faz polling em /status pra pegar
// atualizações até `connected`.

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

export const Route = createFileRoute("/api/public/extension/whatsapp/connect")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }

        const { data: existing } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("id, instance_id, instance_token")
          .eq("barbershop_id", auth.token.barbershop_id)
          .maybeSingle();

        try {
          const { getWhatsAppProvider } = await import("@/lib/whatsapp/provider.server");
          const provider = getWhatsAppProvider();
          const result = await provider.connect({
            barbershop_id: auth.token.barbershop_id,
            existing_instance_id: existing?.instance_id ?? null,
            existing_instance_token: existing?.instance_token ?? null,
          });

          const payload = {
            barbershop_id: auth.token.barbershop_id,
            provider: provider.name,
            instance_id: result.instance_id,
            instance_token: result.instance_token,
            status: result.status,
            last_qr: result.qrcode ?? null,
            last_synced_at: new Date().toISOString(),
          };

          if (existing) {
            await supabaseAdmin
              .from("whatsapp_instances")
              .update(payload)
              .eq("id", existing.id);
          } else {
            await supabaseAdmin.from("whatsapp_instances").insert(payload);
          }

          return jsonResponse(request, {
            ok: true,
            connection: {
              status: result.status,
              qrcode: result.qrcode ?? null,
              phone: null,
              provider: provider.name,
              auth_mode: provider.authMode,
              signup: result.signup ?? null,
            },
          });

        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[whatsapp/connect]", msg);
          return jsonResponse(request, { ok: false, error: msg }, { status: 502 });
        }
      },
    },
  },
});
