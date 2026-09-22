// POST /api/public/hooks/evaluate-followups
//
// Chamado por pg_cron a cada minuto (mesmo padrão de dispatch-jobs.ts).
// Duas famílias de regra, mesma engrenagem de baixo (createFollowupJob):
//
// - "time_in_stage" (padrão, inclui "assim que entrar" com delay 0):
//   pra cada card PARADO na etapa/lista agora, cada passo cujo tempo
//   (stage_entered_at + delay_minutes) já passou dispara.
// - "left_stage": pra cada SAÍDA da etapa/lista já registrada no
//   histórico (funnel_card_stage_history.left_at) ainda não
//   processada por essa regra, dispara os passos (contados a partir do
//   momento da saída, não da entrada).
//
// "max_messages_per_contact": limite opcional por regra — conta quantas
// mensagens essa regra já mandou pro card (nos dois tipos de gatilho,
// somado) e para de disparar passos novos ao atingir o teto.
//
// "skip_if_replied": usa wa_contacts.last_message_at como sinal de
// "teve atividade na conversa depois do gatilho" — o sistema hoje não
// guarda o TEXTO das mensagens (só metadados), então não dá pra
// distinguir se foi o cliente ou a barbearia que mandou a última
// mensagem; ainda assim, é um sinal útil pra não insistir numa
// conversa que já está em andamento.
//
// Autenticação: header `apikey` = SUPABASE_PUBLISHABLE_KEY (padrão pg_cron).

import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";

const BATCH_LIMIT = 300; // cards/saídas avaliados por regra, por rodada

type Step = {
  id: string;
  delay_minutes: number;
  actions: unknown;
  template_name: string | null;
  template_language: string | null;
  template_header_media_path: string | null;
  skip_if_replied: boolean;
};

type Rule = {
  id: string;
  barbershop_id: string;
  funnel_id: string;
  stage_id: string;
  trigger_type: string;
  max_messages_per_contact: number | null;
  funnel_followup_steps: Step[];
};

/** Garante um customer_id de verdade pro card (message_jobs exige um) —
 * muitos leads vindos direto do WhatsApp não têm um vinculado ainda.
 * Reaproveita um cliente já existente com esse telefone, ou cria um
 * (arquivado, mesma convenção já usada em lead-schedule.ts). */
async function ensureCustomerId(
  supabaseAdmin: SupabaseClient,
  barbershopId: string,
  card: { id: string; title: string | null; phone: string | null; customer_id: string | null },
): Promise<string | null> {
  if (card.customer_id) return card.customer_id;
  if (!card.phone) return null;
  const { data: existingCustomer } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("barbershop_id", barbershopId)
    .eq("phone", card.phone)
    .maybeSingle();
  let customerId = existingCustomer?.id ?? null;
  if (!customerId) {
    const { data: createdCustomer } = await supabaseAdmin
      .from("customers")
      .insert({
        barbershop_id: barbershopId,
        name: card.title || card.phone,
        phone: card.phone,
        status: "lead",
        source: "funil",
        archived_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    customerId = createdCustomer?.id ?? null;
  }
  if (customerId) {
    await supabaseAdmin.from("funnel_cards").update({ customer_id: customerId }).eq("id", card.id);
  }
  return customerId;
}

/** Verifica se teve atividade na conversa depois do momento de
 * referência (entrada ou saída, conforme o gatilho) — sinal de
 * "conversa já em andamento", usado por skip_if_replied. */
async function hasRepliedSince(
  supabaseAdmin: SupabaseClient,
  barbershopId: string,
  card: { wa_contact_id: string | null; phone: string | null },
  sinceMs: number,
): Promise<boolean> {
  let lastMessageAt: string | null = null;
  if (card.wa_contact_id) {
    const { data: contact } = await supabaseAdmin
      .from("wa_contacts")
      .select("last_message_at")
      .eq("id", card.wa_contact_id)
      .maybeSingle();
    lastMessageAt = contact?.last_message_at ?? null;
  } else if (card.phone) {
    const { data: contact } = await supabaseAdmin
      .from("wa_contacts")
      .select("last_message_at")
      .eq("barbershop_id", barbershopId)
      .eq("phone", card.phone)
      .maybeSingle();
    lastMessageAt = contact?.last_message_at ?? null;
  }
  return !!lastMessageAt && new Date(lastMessageAt).getTime() > sinceMs;
}

/** Cria o message_job de um passo — mesma lógica pros dois tipos de
 * gatilho, só muda de onde vem "customerId" e o registro de "já
 * enviado" depois. */
async function createFollowupJob(
  supabaseAdmin: SupabaseClient,
  params: {
    barbershopId: string;
    customerId: string;
    phone: string;
    step: Step;
    now: Date;
  },
): Promise<string | null> {
  const usesTemplate = !!params.step.template_name;
  const actions = Array.isArray(params.step.actions) ? params.step.actions : [];
  const firstText =
    (actions as Array<{ type?: string; text?: string }>).find((a) => a?.type === "text")?.text ||
    "";

  const { data: job, error: jobErr } = await supabaseAdmin
    .from("message_jobs")
    .insert({
      barbershop_id: params.barbershopId,
      customer_id: params.customerId,
      phone: params.phone,
      rendered_body: usesTemplate ? `[Modelo: ${params.step.template_name}]` : firstText,
      message_actions: usesTemplate ? [] : actions,
      template_name: usesTemplate ? params.step.template_name : null,
      template_language: usesTemplate ? (params.step.template_language ?? "pt_BR") : null,
      template_header_media_path: usesTemplate ? params.step.template_header_media_path : null,
      status: "pending",
      scheduled_for: params.now.toISOString(),
      expires_at: new Date(params.now.getTime() + 48 * 3600_000).toISOString(),
      funnel_followup_step_id: params.step.id,
    })
    .select("id")
    .single();
  if (jobErr || !job) {
    console.error("[evaluate-followups] falha ao criar job:", jobErr?.message);
    return null;
  }
  return job.id as string;
}

export const Route = createFileRoute("/api/public/hooks/evaluate-followups")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey") ?? "";
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
        if (!apikey || apikey !== expected) {
          return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const now = new Date();

        const { data: rules, error: rulesErr } = await supabaseAdmin
          .from("funnel_followup_rules")
          .select(
            "id, barbershop_id, funnel_id, stage_id, trigger_type, max_messages_per_contact, funnel_followup_steps (id, delay_minutes, actions, template_name, template_language, template_header_media_path, skip_if_replied)",
          )
          .eq("active", true);
        if (rulesErr) {
          return new Response(JSON.stringify({ ok: false, error: rulesErr.message }), {
            status: 500,
          });
        }

        let created = 0;
        for (const ruleRaw of rules ?? []) {
          const rule = ruleRaw as unknown as Rule;
          const steps = (rule.funnel_followup_steps || []).slice();
          if (!steps.length) continue;

          if (rule.trigger_type === "left_stage") {
            created += await processLeftStageRule(supabaseAdmin, rule, steps, now);
          } else {
            created += await processTimeInStageRule(supabaseAdmin, rule, steps, now);
          }
        }

        return new Response(JSON.stringify({ ok: true, created }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});

/** Conta quantas mensagens essa regra já mandou pro card, somando os
 * dois tipos de gatilho — usado pra respeitar max_messages_per_contact. */
async function countSentForRule(
  supabaseAdmin: SupabaseClient,
  ruleId: string,
  stepIds: string[],
  cardId: string,
): Promise<number> {
  if (!stepIds.length) return 0;
  const [timeInStageRes, leftStageRes] = await Promise.all([
    supabaseAdmin
      .from("funnel_followup_sent_log")
      .select("card_id", { count: "exact", head: true })
      .eq("card_id", cardId)
      .in("step_id", stepIds),
    supabaseAdmin
      .from("funnel_followup_left_stage_sent")
      .select("card_id", { count: "exact", head: true })
      .eq("rule_id", ruleId)
      .eq("card_id", cardId),
  ]);
  return (timeInStageRes.count ?? 0) + (leftStageRes.count ?? 0);
}

/** Gatilho padrão: passos disparam conforme o tempo parado na etapa
 * (delay 0 = assim que entrar). Lógica igual à original, só com a
 * checagem de limite adicionada. */
async function processTimeInStageRule(
  supabaseAdmin: SupabaseClient,
  rule: Rule,
  steps: Step[],
  now: Date,
): Promise<number> {
  let created = 0;
  const stepIds = steps.map((s) => s.id);

  const { data: cards, error: cardsErr } = await supabaseAdmin
    .from("funnel_cards")
    .select("id, title, phone, wa_contact_id, customer_id, stage_entered_at")
    .eq("funnel_id", rule.funnel_id)
    .eq("stage_id", rule.stage_id)
    .limit(BATCH_LIMIT);
  if (cardsErr) {
    console.error("[evaluate-followups] falha ao buscar cards:", cardsErr.message);
    return 0;
  }
  if (!cards?.length) return 0;

  const cardIds = cards.map((c: { id: string }) => c.id);
  const { data: sentRows } = await supabaseAdmin
    .from("funnel_followup_sent_log")
    .select("card_id, step_id")
    .in("card_id", cardIds);
  const sentSet = new Set(
    (sentRows ?? []).map((r: { card_id: string; step_id: string }) => `${r.card_id}:${r.step_id}`),
  );

  for (const card of cards) {
    if (!card.phone) continue;
    const customerId = await ensureCustomerId(supabaseAdmin, rule.barbershop_id, card);
    if (!customerId) continue;
    const enteredAt = new Date(card.stage_entered_at as string).getTime();

    if (rule.max_messages_per_contact != null) {
      const sentCount = await countSentForRule(supabaseAdmin, rule.id, stepIds, card.id);
      if (sentCount >= rule.max_messages_per_contact) continue;
    }

    for (const step of steps) {
      const key = `${card.id}:${step.id}`;
      if (sentSet.has(key)) continue;
      const dueAt = enteredAt + step.delay_minutes * 60_000;
      if (now.getTime() < dueAt) continue;

      if (step.skip_if_replied) {
        const replied = await hasRepliedSince(supabaseAdmin, rule.barbershop_id, card, enteredAt);
        if (replied) {
          sentSet.add(key); // não tenta de novo nessa mesma rodada
          continue;
        }
      }

      const jobId = await createFollowupJob(supabaseAdmin, {
        barbershopId: rule.barbershop_id,
        customerId,
        phone: card.phone,
        step,
        now,
      });
      if (!jobId) continue;
      await supabaseAdmin.from("funnel_followup_sent_log").insert({
        card_id: card.id,
        step_id: step.id,
        message_job_id: jobId,
      });
      sentSet.add(key);
      created += 1;
    }
  }
  return created;
}

/** Gatilho "saiu da etapa/lista": busca no histórico saídas já
 * registradas (left_at preenchido), e dispara os passos contados a
 * partir do momento da saída — rastreado POR PASSO (não pela saída
 * inteira), senão um passo com espera longa (ex: 3 dias) nunca
 * chegaria a disparar: seria "descartado" na primeira rodada em que a
 * saída fosse vista, antes do prazo dele vencer. */
async function processLeftStageRule(
  supabaseAdmin: SupabaseClient,
  rule: Rule,
  steps: Step[],
  now: Date,
): Promise<number> {
  let created = 0;
  const stepIds = steps.map((s) => s.id);

  // Só olha saídas dos últimos 90 dias (o maior delay possível) — sem
  // isso, a query cresceria sem limite com o tempo.
  const cutoff = new Date(now.getTime() - 90 * 24 * 3600_000).toISOString();
  const { data: exits, error: exitsErr } = await supabaseAdmin
    .from("funnel_card_stage_history")
    .select("card_id, left_at")
    .eq("stage_id", rule.stage_id)
    .not("left_at", "is", null)
    .gte("left_at", cutoff)
    .order("left_at", { ascending: true })
    .limit(BATCH_LIMIT);
  if (exitsErr) {
    console.error("[evaluate-followups] falha ao buscar saídas:", exitsErr.message);
    return 0;
  }
  if (!exits?.length) return 0;

  const { data: processedRows } = await supabaseAdmin
    .from("funnel_followup_left_stage_sent")
    .select("card_id, step_id, left_at")
    .eq("rule_id", rule.id);
  const processedSet = new Set(
    (processedRows ?? []).map(
      (r: { card_id: string; step_id: string; left_at: string }) =>
        `${r.card_id}:${r.step_id}:${r.left_at}`,
    ),
  );

  for (const exit of exits) {
    const { data: card } = await supabaseAdmin
      .from("funnel_cards")
      .select("id, title, phone, wa_contact_id, customer_id")
      .eq("id", exit.card_id)
      .maybeSingle();
    if (!card?.phone) continue;
    const customerId = await ensureCustomerId(supabaseAdmin, rule.barbershop_id, card);
    if (!customerId) continue;

    if (rule.max_messages_per_contact != null) {
      const sentCount = await countSentForRule(supabaseAdmin, rule.id, stepIds, card.id);
      if (sentCount >= rule.max_messages_per_contact) continue;
    }

    const leftAtMs = new Date(exit.left_at as string).getTime();
    for (const step of steps) {
      const key = `${exit.card_id}:${step.id}:${exit.left_at}`;
      if (processedSet.has(key)) continue;
      const dueAt = leftAtMs + step.delay_minutes * 60_000;
      if (now.getTime() < dueAt) continue; // ainda não chegou a vez desse passo — reavalia na próxima rodada

      if (step.skip_if_replied) {
        const replied = await hasRepliedSince(supabaseAdmin, rule.barbershop_id, card, leftAtMs);
        if (replied) {
          processedSet.add(key);
          await supabaseAdmin.from("funnel_followup_left_stage_sent").insert({
            rule_id: rule.id,
            card_id: exit.card_id,
            step_id: step.id,
            left_at: exit.left_at,
          });
          continue;
        }
      }

      const jobId = await createFollowupJob(supabaseAdmin, {
        barbershopId: rule.barbershop_id,
        customerId,
        phone: card.phone,
        step,
        now,
      });
      if (!jobId) continue;
      await supabaseAdmin.from("funnel_followup_left_stage_sent").insert({
        rule_id: rule.id,
        card_id: exit.card_id,
        step_id: step.id,
        left_at: exit.left_at,
        message_job_id: jobId,
      });
      processedSet.add(key);
      created += 1;
    }
  }
  return created;
}
