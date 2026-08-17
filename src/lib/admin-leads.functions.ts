// Server functions da tela admin de Clientes Interessados (leads do
// formulário "Agendar demonstração") — mesmo padrão de auth das outras
// telas admin (atrás da autenticação do site).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const adminListLeads = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: leads, error } = await supabaseAdmin
    .from("ai_demo_leads")
    .select("id, barbershop_id, name, phone, segment, revenue_range, goal, status, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const shopIds = [...new Set((leads ?? []).map((l) => l.barbershop_id).filter(Boolean))] as string[];
  const { data: shops } = shopIds.length
    ? await supabaseAdmin.from("barbershops").select("id, name").in("id", shopIds)
    : { data: [] };
  const nameById = new Map((shops ?? []).map((s) => [s.id, s.name]));

  return (leads ?? []).map((l) => ({
    ...l,
    barbershop_name: l.barbershop_id ? nameById.get(l.barbershop_id) ?? null : null,
  }));
});

export const adminUpdateLeadStatus = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ id: z.string().uuid(), status: z.enum(["novo", "contatado", "convertido", "descartado"]) }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("ai_demo_leads").update({ status: data.status }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
