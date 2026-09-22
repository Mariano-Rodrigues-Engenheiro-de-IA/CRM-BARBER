// Registra a mudança de etapa no histórico (funnel_card_stage_history)
// — necessário pro gatilho de follow-up "saiu da etapa/lista". Chamado
// em TODO lugar que move um card entre etapas (upsert por telefone,
// PATCH de card, criação de card novo).
//
// Fecha o registro aberto da etapa anterior (left_at = agora) e abre um
// novo pra etapa atual (entered_at = agora, left_at = null). Pra um
// card recém-criado, fromStageId é null — só abre o primeiro registro,
// não fecha nada.

import type { SupabaseClient } from "@supabase/supabase-js";

export async function recordStageChange(
  supabaseAdmin: SupabaseClient,
  params: {
    cardId: string;
    funnelId: string;
    fromStageId: string | null;
    toStageId: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  if (params.fromStageId && params.fromStageId !== params.toStageId) {
    await supabaseAdmin
      .from("funnel_card_stage_history")
      .update({ left_at: now })
      .eq("card_id", params.cardId)
      .eq("stage_id", params.fromStageId)
      .is("left_at", null);
  }
  await supabaseAdmin.from("funnel_card_stage_history").insert({
    card_id: params.cardId,
    funnel_id: params.funnelId,
    stage_id: params.toStageId,
    entered_at: now,
  });
}

/** Registra uma NOVA entrada na etapa mesmo que o card já estivesse
 * nela — usado por "Marcar atendimento": cada clique é um evento novo
 * (o cliente voltou), não uma mudança de etapa de verdade, então o
 * fechamento condicional de recordStageChange (só fecha se saiu de
 * outra etapa) não se aplica aqui. Fecha SEMPRE o registro aberto
 * anterior (se houver) e abre um novo. */
export async function recordReentry(
  supabaseAdmin: SupabaseClient,
  params: { cardId: string; funnelId: string; stageId: string },
): Promise<void> {
  const now = new Date().toISOString();
  await supabaseAdmin
    .from("funnel_card_stage_history")
    .update({ left_at: now })
    .eq("card_id", params.cardId)
    .eq("stage_id", params.stageId)
    .is("left_at", null);
  await supabaseAdmin.from("funnel_card_stage_history").insert({
    card_id: params.cardId,
    funnel_id: params.funnelId,
    stage_id: params.stageId,
    entered_at: now,
  });
}
