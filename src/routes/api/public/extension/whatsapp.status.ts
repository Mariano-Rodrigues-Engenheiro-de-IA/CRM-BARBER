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
          .select("id, status, phone, last_qr, last_synced_at, instance_id, instance_token, provider, phone_number_id, meta_access_token, shared_with_ai, last_error")
          .eq("barbershop_id", auth.token.barbershop_id)
          .maybeSingle();

        // Sem instância ainda.
        if (!inst) {
          const { getWhatsAppProviderByName } = await import("@/lib/whatsapp/provider.server");
          const provider = getWhatsAppProviderByName("uazapi");
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
        }

        const providerName = inst.provider === "meta" ? "meta" : "uazapi";
        const instanceId = providerName === "meta"
          ? inst.phone_number_id ?? inst.instance_id
          : inst.instance_id ?? inst.instance_token;
        const instanceToken = providerName === "meta"
          ? inst.meta_access_token ?? inst.instance_token
          : inst.instance_token;
        const metaNeedsManualCredentials = providerName === "meta" && (!inst.phone_number_id || !inst.meta_access_token);

        // Força sync quando o cliente pede (`?sync=1`) ou quando o cache local não é `connected`.
        const staleMs = inst.status === "connected" ? 15000 : 0;
        const lastSync = inst.last_synced_at ? new Date(inst.last_synced_at).getTime() : 0;
        const ageMs = Date.now() - lastSync;
        // Instância COMPARTILHADA com a IA: um "disconnected" aqui é uma
        // pausa INTENCIONAL do uso pelo CRM, não reflete a sessão real
        // (que continua ativa do lado da IA) — sincronizar de volta
        // reverteria a pausa sozinho, sem o usuário pedir. Por isso o
        // "respeita local" é permanente nesse caso, não só por 30s.
        const disconnectCooldownMs = inst.shared_with_ai ? Infinity : 30000;
        const shouldRespectLocalDisconnect = inst.status === "disconnected" && ageMs < disconnectCooldownMs;
        const shouldSync = !shouldRespectLocalDisconnect && (forceSync || ageMs > staleMs);

        let status = metaNeedsManualCredentials ? "disconnected" : inst.status;
        let phone = inst.phone;
        let qrcode = metaNeedsManualCredentials ? null : inst.last_qr;

        const { getWhatsAppProviderByName } = await import("@/lib/whatsapp/provider.server");
        const provider = getWhatsAppProviderByName(providerName);

        if (metaNeedsManualCredentials && inst.status !== "disconnected") {
          await supabaseAdmin
            .from("whatsapp_instances")
            .update({ status: "disconnected", last_qr: null, last_synced_at: new Date().toISOString() })
            .eq("id", inst.id);
        }

        if (!metaNeedsManualCredentials && shouldSync && instanceToken) {
          try {
            const s = await provider.status({
              instance_id: instanceId ?? instanceToken,
              instance_token: instanceToken,
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
            provider: providerName,
            auth_mode: provider.authMode,
            needs_manual_credentials: metaNeedsManualCredentials,
            last_error: status === "connected" ? null : inst.last_error,
          },
        });
      },
    },
  },
});
