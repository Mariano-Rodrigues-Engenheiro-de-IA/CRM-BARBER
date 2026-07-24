// GET /api/public/extension/whatsapp/status
//
// Retorna o status da instância WhatsApp da barbearia (autenticada via
// token da extensão). Se estiver em `connecting`, sincroniza com o provider
// pra atualizar QR/status; se `connected`, devolve o cache local pra não
// bater no provider a cada 3s.
//
// NUNCA devolve `instance_token` pro cliente.

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

export const Route = createFileRoute("/api/public/extension/whatsapp/status")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }

        const url = new URL(request.url);
        const forceSync = url.searchParams.get("sync") === "1";

        const { data: inst } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("id, status, phone, last_qr, last_synced_at, instance_id, instance_token, provider")
          .eq("barbershop_id", auth.token.barbershop_id)
          .maybeSingle();

        // Sem instância ainda.
        if (!inst) {
          return jsonResponse(request, {
            ok: true,
            connection: { status: "disconnected", phone: null, qrcode: null, provider: "uazapi" },
          });
        }

        // Força sync quando o cliente pede (`?sync=1`) ou quando o cache local não é `connected`.
        const staleMs = inst.status === "connected" ? 15000 : 0;
        const lastSync = inst.last_synced_at ? new Date(inst.last_synced_at).getTime() : 0;
        const shouldSync = forceSync || Date.now() - lastSync > staleMs;

        let status = inst.status;
        let phone = inst.phone;
        let qrcode = inst.last_qr;

        if (shouldSync && inst.instance_token) {
          try {
            const { getWhatsAppProvider } = await import("@/lib/whatsapp/provider.server");
            const provider = getWhatsAppProvider();
            const s = await provider.status({
              instance_id: inst.instance_id ?? inst.instance_token,
              instance_token: inst.instance_token,
            });
            status = s.status;
            phone = s.phone ?? phone;
            qrcode = s.qrcode ?? (s.status === "connected" ? null : qrcode);
            await supabaseAdmin
              .from("whatsapp_instances")
              .update({
                status,
                phone,
                last_qr: status === "connected" ? null : qrcode,
                last_synced_at: new Date().toISOString(),
              })
              .eq("id", inst.id);
          } catch (err) {
            console.warn("[whatsapp/status] provider sync falhou", err);
          }
        }

        return jsonResponse(request, {
          ok: true,
          connection: {
            status,
            phone,
            qrcode: status === "connected" ? null : qrcode,
            provider: inst.provider,
          },
        });
      },
    },
  },
});
