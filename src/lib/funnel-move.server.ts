// Lógica compartilhada para mover um lead entre etapas de um funil (kanban),
// usada tanto pelo disparo em massa (ações de funil de uma Resposta Rápida)
// quanto pela API voltada para agentes de IA (/api/public/ai/move-lead).
//
// Regra: se o contato (por telefone) já tem um card nesse funil, só move de
// coluna. Senão, cria um card novo direto na coluna de destino.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type MoveLeadResult =
  | { ok: true; action: "moved" | "created" | "unchanged"; card_id: string }
  | { ok: false; error: string };

export async function moveLeadToStage(
  supabaseAdmin: SupabaseClient<Database>,
  barbershopId: string,
  input: { phone: string; funnelId: string; stageId: string; title: string; customerId?: string | null },
): Promise<MoveLeadResult> {
  const digits = String(input.phone || "").replace(/\D/g, "");
  if (!digits) return { ok: false, error: "Telefone inválido" };

  const { data: stage } = await supabaseAdmin
    .from("funnel_stages")
    .select("id")
    .eq("id", input.stageId)
    .eq("funnel_id", input.funnelId)
    .eq("barbershop_id", barbershopId)
    .maybeSingle();
  if (!stage) return { ok: false, error: "Etapa não encontrada nesse funil" };

  const { data: existing } = await supabaseAdmin
    .from("funnel_cards")
    .select("id, stage_id")
    .eq("barbershop_id", barbershopId)
    .eq("funnel_id", input.funnelId)
    .eq("phone", digits)
    .maybeSingle();

  if (existing) {
    if (existing.stage_id === input.stageId) {
      return { ok: true, action: "unchanged", card_id: existing.id };
    }
    const { error } = await supabaseAdmin
      .from("funnel_cards")
      .update({ stage_id: input.stageId })
      .eq("id", existing.id)
      .eq("barbershop_id", barbershopId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, action: "moved", card_id: existing.id };
  }

  const { count } = await supabaseAdmin
    .from("funnel_cards")
    .select("id", { count: "exact", head: true })
    .eq("stage_id", input.stageId);

  const { data: created, error } = await supabaseAdmin
    .from("funnel_cards")
    .insert({
      barbershop_id: barbershopId,
      funnel_id: input.funnelId,
      stage_id: input.stageId,
      title: input.title,
      phone: digits,
      customer_id: input.customerId ?? null,
      sort_order: count ?? 0,
    })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: error?.message ?? "Falha ao criar card" };
  return { ok: true, action: "created", card_id: created.id };
}

/** Acha um funil e uma etapa pelo nome (sem diferenciar maiúsculas/acentos
 * de forma estrita) ou pelo ID exato — uma IA que conversa em linguagem
 * natural nem sempre vai ter o UUID exato à mão. */
export async function resolveFunnelAndStage(
  supabaseAdmin: SupabaseClient<Database>,
  barbershopId: string,
  funnelRef: string,
  stageRef: string,
): Promise<{ ok: true; funnelId: string; stageId: string } | { ok: false; error: string }> {
  const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

  const { data: funnels } = await supabaseAdmin
    .from("funnels")
    .select("id, name")
    .eq("barbershop_id", barbershopId);
  const funnel = isUuid(funnelRef)
    ? (funnels ?? []).find((f) => f.id === funnelRef)
    : (funnels ?? []).find((f) => f.name.trim().toLowerCase() === funnelRef.trim().toLowerCase());
  if (!funnel) {
    return {
      ok: false,
      error: `Funil "${funnelRef}" não encontrado. Funis existentes: ${(funnels ?? []).map((f) => f.name).join(", ") || "nenhum"}`,
    };
  }

  const { data: stages } = await supabaseAdmin
    .from("funnel_stages")
    .select("id, name")
    .eq("barbershop_id", barbershopId)
    .eq("funnel_id", funnel.id);
  const stage = isUuid(stageRef)
    ? (stages ?? []).find((s) => s.id === stageRef)
    : (stages ?? []).find((s) => s.name.trim().toLowerCase() === stageRef.trim().toLowerCase());
  if (!stage) {
    return {
      ok: false,
      error: `Etapa "${stageRef}" não encontrada no funil "${funnel.name}". Etapas existentes: ${(stages ?? []).map((s) => s.name).join(", ") || "nenhuma"}`,
    };
  }

  return { ok: true, funnelId: funnel.id, stageId: stage.id };
}
