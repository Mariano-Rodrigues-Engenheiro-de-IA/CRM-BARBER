// POST /api/public/extension/pair
//
// Chamado pela extensão logo depois que ela lê o número logado no WhatsApp Web.
// Body: { phone: string, install_id: string, label?: string }
//
// Fluxo:
//  1. Normaliza phone (só dígitos).
//  2. Procura barbershop por owner_phone. Se não achar → 404 (dono precisa
//     se cadastrar antes na landing).
//  3. Se já existe um token ativo pra esse install_id (label = "ext:<install_id>"),
//     revoga e emite outro (rotação sem cadastro duplicado).
//  4. Cria extension_tokens, retorna o token cru UMA vez.
//
// Sem auth prévia — a autenticidade vem do fato de o número ter passado pelo
// signup manual (owner_phone) e do install_id do Chrome. Não é infalível
// (alguém que saiba o telefone de um cliente consegue parear), mas é o mesmo
// modelo do WaSeller. Roadmap: exigir código de confirmação por WhatsApp.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { generateRawToken, hashToken } from "@/lib/extension-auth";

const bodySchema = z.object({
  phone: z.string().min(6).max(30),
  install_id: z.string().min(4).max(80),
  label: z.string().max(80).optional(),
});

function normalizePhone(input: string): string {
  return input.replace(/\D+/g, "");
}

export const Route = createFileRoute("/api/public/extension/pair")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      POST: async ({ request }) => {
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return jsonResponse(request, { ok: false, error: "Invalid JSON" }, { status: 400 });
        }
        const parsed = bodySchema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: "Dados inválidos" }, { status: 400 });
        }

        const phone = normalizePhone(parsed.data.phone);
        if (phone.length < 8) {
          return jsonResponse(request, { ok: false, error: "Telefone inválido" }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: shop } = await supabaseAdmin
          .from("barbershops")
          .select("id, name")
          .eq("owner_phone", phone)
          .maybeSingle();

        if (!shop) {
          return jsonResponse(
            request,
            {
              ok: false,
              error: "Número não cadastrado. Faça o cadastro na landing primeiro.",
              code: "not_registered",
            },
            { status: 404 },
          );
        }

        const label = (parsed.data.label ?? "Chrome") + ` · ${parsed.data.install_id.slice(0, 8)}`;

        // Revoga tokens anteriores desse install_id (mesmo label prefix).
        await supabaseAdmin
          .from("extension_tokens")
          .update({ revoked_at: new Date().toISOString() })
          .eq("barbershop_id", shop.id)
          .is("revoked_at", null)
          .like("label", `%${parsed.data.install_id.slice(0, 8)}`);

        const raw = generateRawToken();
        const token_hash = await hashToken(raw);

        const { error: insertErr } = await supabaseAdmin.from("extension_tokens").insert({
          barbershop_id: shop.id,
          label,
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
