// Server functions da tela admin de emissão de tokens de integração
// (usados por integrações externas, como a IA de atendimento, para
// chamar as APIs /api/public/ai/*). Rotas fora de /api/public ficam
// atrás da autenticação do site — mesmo padrão de admin-whatsapp.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const adminListShopsForTokens = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: shops, error } = await supabaseAdmin
    .from("barbershops")
    .select("id, name")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const { data: tokens } = await supabaseAdmin
    .from("extension_tokens")
    .select("barbershop_id, revoked_at");

  const activeCountByShop = new Map<string, number>();
  for (const t of tokens ?? []) {
    if (t.revoked_at) continue;
    activeCountByShop.set(t.barbershop_id, (activeCountByShop.get(t.barbershop_id) ?? 0) + 1);
  }

  return (shops ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    active_tokens: activeCountByShop.get(s.id) ?? 0,
  }));
});

const issueSchema = z.object({
  barbershop_id: z.string().uuid(),
  label: z.string().max(80).optional(),
});

export const adminIssueToken = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => issueSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { generateRawToken, hashToken } = await import("./extension-auth");

    const { data: shop } = await supabaseAdmin
      .from("barbershops")
      .select("id, name")
      .eq("id", data.barbershop_id)
      .maybeSingle();
    if (!shop) throw new Error("Barbearia não encontrada");

    const raw = generateRawToken();
    const token_hash = await hashToken(raw);
    const { error } = await supabaseAdmin.from("extension_tokens").insert({
      barbershop_id: shop.id,
      label: data.label ?? "Integração manual (painel admin)",
      token_hash,
    });
    if (error) throw new Error("Falha ao emitir token: " + error.message);

    return { token: raw, barbershop: { id: shop.id, name: shop.name } };
  });
