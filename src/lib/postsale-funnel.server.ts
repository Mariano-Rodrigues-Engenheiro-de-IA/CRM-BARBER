// Garante o funil especial "Pós-venda" + etapa fixa "Atendidos" existam
// pra uma barbearia — mesmo padrão de auto-criação do funil "Listas".
//
// Extraído de mark-attendance.ts (22/09): antes só era criado no
// primeiro clique em "Marcar atendimento", o que significava que a
// tela de configuração (Pós-venda/Retorno) ficava bloqueada até
// alguém já ter sido atendido — impossível configurar a mensagem
// ANTES do primeiro atendimento de verdade, exatamente o contrário do
// que faz sentido (o cliente precisa receber a mensagem já configurada
// desde o primeiro atendimento). Agora chamado também proativamente
// pela tela de configuração, ao abrir.

import type { SupabaseClient } from "@supabase/supabase-js";

export const POSTSALE_FUNNEL_NAME = "Pós-venda";
export const POSTSALE_STAGE_NAME = "Atendidos";

export async function ensurePostsaleFunnel(
  supabaseAdmin: SupabaseClient,
  barbershopId: string,
): Promise<{ funnel: { id: string }; stage: { id: string } } | { error: string }> {
  let { data: funnel } = await supabaseAdmin
    .from("funnels")
    .select("id")
    .eq("barbershop_id", barbershopId)
    .eq("mode", "postsale")
    .maybeSingle();
  if (!funnel) {
    const { data: createdFunnel, error: funnelErr } = await supabaseAdmin
      .from("funnels")
      .insert({ barbershop_id: barbershopId, name: POSTSALE_FUNNEL_NAME, mode: "postsale" })
      .select("id")
      .single();
    if (funnelErr || !createdFunnel) {
      return { error: funnelErr?.message ?? "Falha ao criar funil de pós-venda" };
    }
    funnel = createdFunnel;
  }

  let { data: stage } = await supabaseAdmin
    .from("funnel_stages")
    .select("id")
    .eq("funnel_id", funnel.id)
    .eq("barbershop_id", barbershopId)
    .maybeSingle();
  if (!stage) {
    const { data: createdStage, error: stageErr } = await supabaseAdmin
      .from("funnel_stages")
      .insert({
        barbershop_id: barbershopId,
        funnel_id: funnel.id,
        name: POSTSALE_STAGE_NAME,
        sort_order: 0,
      })
      .select("id")
      .single();
    if (stageErr || !createdStage) {
      return { error: stageErr?.message ?? "Falha ao criar etapa de pós-venda" };
    }
    stage = createdStage;
  }

  return { funnel, stage };
}
