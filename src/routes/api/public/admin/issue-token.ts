// POST /api/public/admin/issue-token
//
// Emite um token de acesso (o mesmo tipo usado pela extensão do Chrome)
// para uma barbearia específica, sem precisar passar pelo fluxo de
// pareamento normal (telefone + install_id). Pensado para gerar tokens
// usados em integrações server-to-server (ex: IA de atendimento externa
// chamando /api/public/ai/*) — não interfere em nada com tokens já
// existentes (da extensão instalada, por exemplo); múltiplos tokens
// coexistem sem conflito, cada um pode ser revogado independentemente.
//
// Protegido por uma chave simples (header x-admin-secret), configurada
// como variável de ambiente INTERNAL_ADMIN_SECRET — sem essa variável
// configurada, o endpoint recusa qualquer chamada.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { generateRawToken, hashToken } from "@/lib/extension-auth";

const bodySchema = z.object({
  barbershop_id: z.string().uuid(),
  label: z.string().max(80).optional(),
});

export const Route = createFileRoute("/api/public/admin/issue-token")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      POST: async ({ request }) => {
        const expectedSecret = process.env.INTERNAL_ADMIN_SECRET;
        if (!expectedSecret) {
          return jsonResponse(
            request,
            { ok: false, error: "INTERNAL_ADMIN_SECRET não configurado no servidor." },
            { status: 500 },
          );
        }
        const providedSecret = request.headers.get("x-admin-secret");
        if (providedSecret !== expectedSecret) {
          return jsonResponse(request, { ok: false, error: "Não autorizado" }, { status: 401 });
        }

        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return jsonResponse(request, { ok: false, error: "JSON inválido" }, { status: 400 });
        }
        const parsed = bodySchema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: "Dados inválidos" }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: shop } = await supabaseAdmin
          .from("barbershops")
          .select("id, name")
          .eq("id", parsed.data.barbershop_id)
          .maybeSingle();
        if (!shop) {
          return jsonResponse(request, { ok: false, error: "Barbearia não encontrada" }, { status: 404 });
        }

        const raw = generateRawToken();
        const token_hash = await hashToken(raw);
        const { error: insertErr } = await supabaseAdmin.from("extension_tokens").insert({
          barbershop_id: shop.id,
          label: parsed.data.label ?? "Integração manual (admin)",
          token_hash,
        });
        if (insertErr) {
          return jsonResponse(request, { ok: false, error: "Falha ao emitir token" }, { status: 500 });
        }

        return jsonResponse(request, {
          ok: true,
          token: raw,
          barbershop: { id: shop.id, name: shop.name },
        });
      },
    },
  },
});
