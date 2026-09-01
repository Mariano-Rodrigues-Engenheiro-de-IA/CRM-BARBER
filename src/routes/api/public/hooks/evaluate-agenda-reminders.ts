// POST /api/public/hooks/evaluate-agenda-reminders
//
// Chamado por pg_cron a cada minuto (mesmo padrão de dispatch-jobs.ts).
// Pra cada regra ATIVA de lembrete/confirmação, procura agendamentos cujo
// horário de disparo (scheduled_at - offset_minutes) já chegou, ainda não
// receberam ESSA regra (agenda_reminder_sent_log), e cujo status está na
// lista de status aceitos pela regra — cria um message_job e registra o
// envio, pra nunca mandar a mesma regra duas vezes pro mesmo agendamento.
//
// Autenticação: header `apikey` = SUPABASE_PUBLISHABLE_KEY (padrão pg_cron).

import { createFileRoute } from "@tanstack/react-router";
import { renderAgendaReminderText } from "@/lib/agenda-reminders";

const BATCH_LIMIT = 200; // agendamentos avaliados por regra, por rodada

export const Route = createFileRoute("/api/public/hooks/evaluate-agenda-reminders")({
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
          .from("agenda_reminder_rules")
          .select("id, barbershop_id, name, kind, offset_minutes, applies_to_statuses, message_text, template_name, template_language, confirm_button_text")
          .eq("active", true);
        if (rulesErr) {
          return new Response(JSON.stringify({ ok: false, error: rulesErr.message }), { status: 500 });
        }

        let created = 0;
        for (const rule of rules ?? []) {
          // O ponto de corte: agendamentos cujo (scheduled_at - offset)
          // já passou. Só olha os das próximas ~48h pra trás até agora,
          // pra não escanear a tabela inteira de agendamentos antigos a
          // cada rodada.
          const cutoff = new Date(now.getTime() + rule.offset_minutes * 60_000).toISOString();
          const lookbackFloor = new Date(now.getTime() - 48 * 3600_000).toISOString();

          const { data: appointments, error: apptErr } = await supabaseAdmin
            .from("appointments")
            .select("id, title, scheduled_at, status, customer_id, professional_id, service_id, customers(name, phone)")
            .eq("barbershop_id", rule.barbershop_id)
            .in("status", rule.applies_to_statuses)
            .lte("scheduled_at", cutoff)
            .gte("scheduled_at", lookbackFloor)
            .limit(BATCH_LIMIT);
          if (apptErr) {
            console.error("[evaluate-agenda-reminders] falha ao buscar agendamentos:", apptErr.message);
            continue;
          }
          if (!appointments?.length) continue;

          // Quais desses já receberam ESSA regra — evita duplicar.
          const { data: already } = await supabaseAdmin
            .from("agenda_reminder_sent_log")
            .select("appointment_id")
            .eq("rule_id", rule.id)
            .in("appointment_id", appointments.map((a) => a.id));
          const alreadySent = new Set((already ?? []).map((r) => r.appointment_id as string));

          for (const appt of appointments) {
            if (alreadySent.has(appt.id)) continue;
            const customer = appt.customers as { name: string; phone: string } | null;
            if (!customer?.phone || !appt.customer_id) continue;

            let professionalName = "";
            let serviceName = "";
            if (appt.professional_id) {
              const { data: prof } = await supabaseAdmin
                .from("professionals")
                .select("name")
                .eq("id", appt.professional_id)
                .maybeSingle();
              professionalName = prof?.name ?? "";
            }
            if (appt.service_id) {
              const { data: svc } = await supabaseAdmin
                .from("services")
                .select("name")
                .eq("id", appt.service_id)
                .maybeSingle();
              serviceName = svc?.name ?? "";
            }
            const dt = new Date(appt.scheduled_at as string);
            const vars = {
              nome: customer.name || "",
              data: dt.toLocaleDateString("pt-BR"),
              hora: dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
              servico: serviceName,
              profissional: professionalName,
            };

            // Confirmação sempre usa modelo. Lembrete pode usar modelo OU
            // texto livre — depende do que foi configurado na regra
            // (a tela só oferece texto livre quando o número não está
            // conectado via Meta, já que texto livre não é entregue de
            // forma confiável na API oficial).
            const usesTemplate = rule.kind === "confirmation" || !!rule.template_name;
            const { data: job, error: jobErr } = await supabaseAdmin
              .from("message_jobs")
              .insert({
                barbershop_id: rule.barbershop_id,
                customer_id: appt.customer_id,
                phone: customer.phone,
                rendered_body: usesTemplate
                  ? `[Modelo: ${rule.template_name}]`
                  : renderAgendaReminderText(rule.message_text || "", vars),
                template_name: usesTemplate ? rule.template_name : null,
                template_language: usesTemplate ? rule.template_language : null,
                status: "pending",
                scheduled_for: now.toISOString(),
                expires_at: new Date(now.getTime() + 48 * 3600_000).toISOString(),
                appointment_id: appt.id,
                agenda_reminder_rule_id: rule.id,
              })
              .select("id")
              .single();
            if (jobErr || !job) {
              console.error("[evaluate-agenda-reminders] falha ao criar job:", jobErr?.message);
              continue;
            }
            await supabaseAdmin.from("agenda_reminder_sent_log").insert({
              appointment_id: appt.id,
              rule_id: rule.id,
              message_job_id: job.id,
            });
            created += 1;
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
