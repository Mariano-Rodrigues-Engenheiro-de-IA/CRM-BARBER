// GET  /api/public/extension/funnels -> funis com colunas e cards
// POST /api/public/extension/funnels -> cria funil (com colunas padrão)

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { funnelSchema } from "@/lib/funnels";

export const Route = createFileRoute("/api/public/extension/funnels")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const shop = auth.token.barbershop_id;

        const funnels = await supabaseAdmin
          .from("funnels")
          .select("id, name, mode, source_label_id, sort_order")
          .eq("barbershop_id", shop)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });

        const stages = await supabaseAdmin
          .from("funnel_stages")
          .select("id, funnel_id, name, color, sort_order")
          .eq("barbershop_id", shop)
          .order("sort_order", { ascending: true });

        // Tipo largo: os fallbacks abaixo usam selects mais enxutos, com
        // formato diferente, e o TS não aceita reatribuir sem isso.
        let cards: { data: any[] | null; error: { message: string } | null } = await supabaseAdmin
          .from("funnel_cards")
          .select(
            "id, funnel_id, stage_id, title, phone, value_cents, notes, sort_order, customer_id, wa_contact_id, stage_entered_at, wa_contacts(wa_id, label_ids, profile_picture_url, unread_count)",
          )
          .eq("barbershop_id", shop)
          .order("sort_order", { ascending: true });

        // Se colunas novas não existirem ainda (migration pendente), tenta
        // de novo com um select mais enxuto, indo removendo uma de cada vez.
        if (cards.error?.message?.includes("unread_count")) {
          cards = await supabaseAdmin
            .from("funnel_cards")
            .select(
              "id, funnel_id, stage_id, title, phone, value_cents, notes, sort_order, customer_id, wa_contact_id, stage_entered_at, wa_contacts(wa_id, label_ids, profile_picture_url)",
            )
            .eq("barbershop_id", shop)
            .order("sort_order", { ascending: true });
        }
        if (cards.error?.message?.includes("profile_picture_url")) {
          cards = await supabaseAdmin
            .from("funnel_cards")
            .select(
              "id, funnel_id, stage_id, title, phone, value_cents, notes, sort_order, customer_id, wa_contact_id, stage_entered_at, wa_contacts(wa_id, label_ids)",
            )
            .eq("barbershop_id", shop)
            .order("sort_order", { ascending: true });
        }

        const error = funnels.error || stages.error || cards.error;
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }

        // wa_contacts(wa_id, label_ids) vem aninhado pelo relacionamento;
        // achata pra card.wa_id/card.label_ids diretos. wa_contact_id
        // sozinho é só o UUID interno, não serve pra abrir chat nem pra
        // saber a cor da etiqueta.
        const flatCards = (cards.data ?? []).map((c: any) => ({
          ...c,
          wa_id: c.wa_contacts?.wa_id ?? null,
          label_ids: c.wa_contacts?.label_ids ?? [],
          profile_picture_url: c.wa_contacts?.profile_picture_url ?? null,
          unread_count: c.wa_contacts?.unread_count ?? 0,
          wa_contacts: undefined,
        }));

        // Status de follow-up por card — pro reloginho no kanban e pro
        // indicador dentro da conversa na extensão saberem, sem chamada
        // extra, se esse lead vai receber (e quando) ou já recebeu tudo.
        const { data: followupRules } = await supabaseAdmin
          .from("funnel_followup_rules")
          .select("id, funnel_id, stage_id, active, funnel_followup_steps(id, delay_minutes, sort_order)")
          .eq("barbershop_id", shop)
          .eq("active", true);
        const ruleByStage = new Map(
          (followupRules ?? []).map((r) => [`${r.funnel_id}:${r.stage_id}`, r]),
        );
        const cardIds = flatCards.map((c: any) => c.id);
        const { data: sentLog } = cardIds.length
          ? await supabaseAdmin
              .from("funnel_followup_sent_log")
              .select("card_id, step_id, sent_at")
              .in("card_id", cardIds)
          : { data: [] as { card_id: string; step_id: string; sent_at: string }[] };
        const sentByCard = new Map<string, Map<string, string>>();
        for (const log of sentLog ?? []) {
          if (!sentByCard.has(log.card_id)) sentByCard.set(log.card_id, new Map());
          sentByCard.get(log.card_id)!.set(log.step_id, log.sent_at);
        }

        // Contagem de anotações e mensagens agendadas por card — pro
        // selinho nos ícones do kanban, sem precisar abrir o card pra
        // saber se tem algo. Busca tudo de uma vez (não card por card) e
        // conta na memória, mesmo padrão já usado pro follow-up acima.
        const { data: notesRows } = await supabaseAdmin
          .from("lead_notes")
          .select("wa_contact_id, phone")
          .eq("barbershop_id", shop);
        const { data: scheduleRows } = await supabaseAdmin
          .from("message_jobs")
          .select("phone")
          .eq("barbershop_id", shop)
          .eq("status", "pending")
          .is("campaign_id", null)
          .is("funnel_followup_step_id", null)
          .is("agenda_reminder_rule_id", null);

        const flatCardsWithFollowup = flatCards.map((c: any) => {
          const rule = ruleByStage.get(`${c.funnel_id}:${c.stage_id}`) as
            | { funnel_followup_steps: Array<{ id: string; delay_minutes: number; sort_order: number }> }
            | undefined;
          const steps = (rule?.funnel_followup_steps ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
          const notesCount = (notesRows ?? []).filter(
            (n) => (c.wa_contact_id && n.wa_contact_id === c.wa_contact_id) || (c.phone && n.phone === c.phone),
          ).length;
          const scheduleCount = (scheduleRows ?? []).filter((j) => c.phone && j.phone === c.phone).length;
          if (!steps.length) return { ...c, followup: null, notes_count: notesCount, schedule_count: scheduleCount };
          const sentMap = sentByCard.get(c.id) ?? new Map<string, string>();
          const sentSteps = steps.filter((s) => sentMap.has(s.id));
          const nextStep = steps.find((s) => !sentMap.has(s.id));
          const enteredAt = c.stage_entered_at ? new Date(c.stage_entered_at).getTime() : null;
          const nextDueAt =
            nextStep && enteredAt ? new Date(enteredAt + nextStep.delay_minutes * 60_000).toISOString() : null;
          const lastSentAt = sentSteps.length
            ? sentSteps
                .map((s) => sentMap.get(s.id) as string)
                .sort()
                .at(-1)!
            : null;
          return {
            ...c,
            notes_count: notesCount,
            schedule_count: scheduleCount,
            followup: {
              total_steps: steps.length,
              sent_count: sentSteps.length,
              all_sent: !nextStep,
              next_due_at: nextDueAt,
              last_sent_at: lastSentAt,
            },
          };
        });

        const result = (funnels.data ?? []).map((f) => ({
          ...f,
          stages: (stages.data ?? []).filter((s) => s.funnel_id === f.id),
          cards: flatCardsWithFollowup.filter((c: any) => c.funnel_id === f.id),
        }));
        return jsonResponse(request, { ok: true, funnels: result });
      },

      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return jsonResponse(request, { ok: false, error: "Invalid JSON" }, { status: 400 });
        }
        const parsed = funnelSchema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: "Dados inválidos" }, { status: 400 });
        }
        const shop = auth.token.barbershop_id;

        // Evita duplicar funis padrão (mode: tab ou label)
        if (parsed.data.mode === "tab" || parsed.data.mode === "label") {
          const { data: existing } = await supabaseAdmin
            .from("funnels")
            .select("id, name, mode, source_label_id, sort_order")
            .eq("barbershop_id", shop)
            .eq("mode", parsed.data.mode)
            .maybeSingle();
          
          if (existing) {
            const { data: stages } = await supabaseAdmin
              .from("funnel_stages")
              .select("id, funnel_id, name, color, sort_order")
              .eq("funnel_id", existing.id)
              .order("sort_order", { ascending: true });
            
            return jsonResponse(request, {
              ok: true,
              funnel: { ...existing, stages: stages ?? [], cards: [] },
            });
          }
        }

        const { count } = await supabaseAdmin
          .from("funnels")
          .select("id", { count: "exact", head: true })
          .eq("barbershop_id", shop);

        const { data: funnel, error } = await supabaseAdmin
          .from("funnels")
          .insert({
            barbershop_id: shop,
            name: parsed.data.name,
            mode: parsed.data.mode,
            source_label_id: parsed.data.source_label_id ?? null,
            sort_order: count ?? 0,
          })
          .select("id, name, mode, source_label_id, sort_order")
          .single();
        if (error || !funnel) {
          return jsonResponse(request, { ok: false, error: error?.message || "Erro" }, { status: 500 });
        }

        // Funil novo nasce sem etapas: o usuário monta as colunas depois.
        const names = parsed.data.stages ?? [];
        let stages: Array<Record<string, unknown>> = [];
        if (names.length) {
          const { data, error: stagesError } = await supabaseAdmin
            .from("funnel_stages")
            .insert(
              names.map((name, i) => ({
                barbershop_id: shop,
                funnel_id: funnel.id,
                name,
                sort_order: i,
              })),
            )
            .select("id, funnel_id, name, color, sort_order");
          if (stagesError) {
            return jsonResponse(request, { ok: false, error: stagesError.message }, { status: 500 });
          }
          stages = data ?? [];
        }


        return jsonResponse(request, {
          ok: true,
          funnel: { ...funnel, stages: stages ?? [], cards: [] },
        });
      },
    },
  },
});
