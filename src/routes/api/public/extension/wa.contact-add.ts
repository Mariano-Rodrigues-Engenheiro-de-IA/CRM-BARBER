// POST /api/public/extension/wa/contact-add
//
// Salva o contato na agenda da própria conta conectada — só funciona pra
// quem está no modo não oficial (uazapi), que opera no nível do
// protocolo do WhatsApp e por isso consegue escrever na agenda. A API
// oficial da Meta não tem esse conceito (ver comentário em types.ts).

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

export const Route = createFileRoute("/api/public/extension/wa/contact-add")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }

        const body = await request.json().catch(() => null);
        const number = typeof body?.number === "string" ? body.number.trim() : "";
        const name = typeof body?.name === "string" ? body.name.trim() : "";
        if (!number || !name) {
          return jsonResponse(request, { ok: false, error: "Campos obrigatórios: number, name" }, { status: 400 });
        }

        const { data: instance } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("provider, instance_token")
          .eq("barbershop_id", auth.token.barbershop_id)
          .maybeSingle();

        if (!instance || instance.provider !== "uazapi" || !instance.instance_token) {
          return jsonResponse(
            request,
            { ok: false, error: "Pra salvar contato, sua conta precisa estar conectada pela API não oficial" },
            { status: 400 },
          );
        }

        const { getWhatsAppProviderByName } = await import("@/lib/whatsapp/provider.server");
        const provider = getWhatsAppProviderByName("uazapi");
        if (!provider.addContact) {
          return jsonResponse(request, { ok: false, error: "Provider atual não suporta salvar contato." }, { status: 500 });
        }

        const result = await provider.addContact({ instance_token: instance.instance_token, number, name });
        if (!result.ok) {
          return jsonResponse(request, { ok: false, error: result.error }, { status: 502 });
        }
        return jsonResponse(request, { ok: true });
      },
    },
  },
});
