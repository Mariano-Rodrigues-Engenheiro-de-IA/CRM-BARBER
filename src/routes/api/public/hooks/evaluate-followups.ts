// POST /api/public/hooks/evaluate-followups
//
// Chamado por pg_cron a cada minuto (mesmo padrão de dispatch-jobs.ts).
// Pra cada regra ATIVA de follow-up (funil + etapa), pega os cards
// PARADOS naquela etapa agora e, pra cada passo da sequência cujo tempo
// (stage_entered_at + delay_minutes) já passou e ainda não disparou pra
// esse card, cria um message_job — e registra em
// funnel_followup_sent_log pra nunca repetir o mesmo passo.
//
// "skip_if_replied": usa wa_contacts.last_message_at como sinal de
// "teve atividade na conversa depois de entrar na etapa" — o sistema
// hoje não guarda o TEXTO das mensagens (só metadados), então não dá pra
// distinguir se foi o cliente ou a barbearia que mandou a última
// mensagem; ainda assim, é um sinal útil pra não insistir numa conversa
// que já está em andamento.
//
// Autenticação: header `apikey` = SUPABASE_PUBLISHABLE_KEY (padrão pg_cron).

import { createFileRoute } from "@tanstack/react-router";

const BATCH_LIMIT = 300; // cards avaliados por regra, por rodada

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
          .select("id, barbershop_id, funnel_id, stage_id, funnel_followup_steps (id, delay_minutes, actions, skip_if_replied)")
          .eq("active", true);
        if (rulesErr) {
          return new Response(JSON.stringify({ ok: false, error: rulesErr.message }), { status: 500 });
        }

        let created = 0;
        for (const rule of rules ?? []) {
          const steps = (rule.funnel_followup_steps as Array<{
            id: string;
            delay_minutes: number;
            actions: unknown;
            skip_if_replied: boolean;
          }>) || [];
          if (!steps.length) continue;

          const { data: cards, error: cardsErr } = await supabaseAdmin
            .from("funnel_cards")
            .select("id, title, phone, wa_contact_id, customer_id, stage_entered_at")
            .eq("funnel_id", rule.funnel_id)
            .eq("stage_id", rule.stage_id)
            .limit(BATCH_LIMIT);
          if (cardsErr) {
            console.error("[evaluate-followups] falha ao buscar cards:", cardsErr.message);
            continue;
          }
          if (!cards?.length) continue;

          const cardIds = cards.map((c) => c.id);
          const { data: sentRows } = await supabaseAdmin
            .from("funnel_followup_sent_log")
            .select("card_id, step_id")
            .in("card_id", cardIds);
          const sentSet = new Set((sentRows ?? []).map((r) => `${r.card_id}:${r.step_id}`));

          for (const card of cards) {
            if (!card.phone || !card.customer_id) continue;
            const enteredAt = new Date(card.stage_entered_at as string).getTime();

            for (const step of steps) {
              const key = `${card.id}:${step.id}`;
              if (sentSet.has(key)) continue;
              const dueAt = enteredAt + step.delay_minutes * 60_000;
              if (now.getTime() < dueAt) continue;

              if (step.skip_if_replied) {
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
                    .eq("barbershop_id", rule.barbershop_id)
                    .eq("phone", card.phone)
                    .maybeSingle();
                  lastMessageAt = contact?.last_message_at ?? null;
                }
                if (lastMessageAt && new Date(lastMessageAt).getTime() > enteredAt) {
                  // Teve atividade na conversa depois que o lead entrou
                  // nessa etapa — pula este passo (mas os PRÓXIMOS passos
                  // da sequência continuam avaliando normalmente).
                  sentSet.add(key); // não tenta de novo nessa mesma rodada
                  continue;
                }
              }

              const actions = Array.isArray(step.actions) ? step.actions : [];
              const firstText =
                (actions as Array<{ type?: string; text?: string }>).find((a) => a?.type === "text")?.text || "";

              const { data: job, error: jobErr } = await supabaseAdmin
                .from("message_jobs")
                .insert({
                  barbershop_id: rule.barbershop_id,
                  customer_id: card.customer_id,
                  phone: card.phone,
                  rendered_body: firstText,
                  message_actions: actions,
                  status: "pending",
                  scheduled_for: now.toISOString(),
                  expires_at: new Date(now.getTime() + 48 * 3600_000).toISOString(),
                  funnel_followup_step_id: step.id,
                })
                .select("id")
                .single();
              if (jobErr || !job) {
                console.error("[evaluate-followups] falha ao criar job:", jobErr?.message);
                continue;
              }
              await supabaseAdmin.from("funnel_followup_sent_log").insert({
                card_id: card.id,
                step_id: step.id,
                message_job_id: job.id,
              });
              sentSet.add(key);
              created += 1;
            }
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
