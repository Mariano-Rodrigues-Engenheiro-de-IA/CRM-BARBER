// POST /api/public/hooks/evaluate-agenda-reminders
//
// Chamado por pg_cron a cada minuto (mesmo padrão de dispatch-jobs.ts).
// Pra cada regra ATIVA de lembrete/confirmação, procura agendamentos cujo
// horário de disparo (scheduled_at - offset_minutes) está DENTRO DE UMA
// JANELA RECENTE (ver GRACE_MINUTES abaixo), ainda não receberam ESSA
// regra (agenda_reminder_sent_log), e cujo status está na lista de
// status aceitos pela regra — cria um message_job e registra o envio,
// pra nunca mandar a mesma regra duas vezes pro mesmo agendamento.
//
// Autenticação: header `apikey` = SUPABASE_PUBLISHABLE_KEY (padrão pg_cron).

import { createFileRoute } from "@tanstack/react-router";
import { renderAgendaReminderText } from "@/lib/agenda-reminders";

const BATCH_LIMIT = 200; // agendamentos avaliados por regra, por rodada

// ACHADO DE BUG REAL (relatado pelo Mariano, confirmado com dados de
// produção): antes, o limite de baixo da busca era um "48h pra trás"
// FIXO, não ligado à antecedência da regra. Toda vez que uma regra
// NOVA era criada, ela nunca tinha mandado nada pra ninguém — então, na
// primeira rodada, o sistema achava que TODO agendamento das últimas
// 48h estava "atrasado" e disparava tudo de uma vez, na hora errada
// (viu-se confirmação de "4 horas antes" disparando 6+ horas DEPOIS do
// horário ideal, pra agendamentos que já tinham passado).
//
// Correção: a janela de busca agora é sempre relativa ao momento IDEAL
// de disparo (scheduled_at - offset_minutes), não ao agendamento em si.
// Só dispara se esse momento ideal caiu dentro dos últimos
// GRACE_MINUTES — cobre folga pra reprocessar depois de uma queda do
// servidor, mas nunca dispara retroativo pra trás de verdade quando uma
// regra é criada ou reativada.
const GRACE_MINUTES = 20;

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
          .select("id, barbershop_id, name, kind, offset_minutes, applies_to_statuses, message_text, template_name, template_language, template_header_media_path")
          .eq("active", true);
        if (rulesErr) {
          return new Response(JSON.stringify({ ok: false, error: rulesErr.message }), { status: 500 });
        }

        let created = 0;
        for (const rule of rules ?? []) {
          // Provedor conectado dessa barbearia/clínica — decide se
          // confirmação pode usar modelo (só a Meta suporta) ou texto
          // livre.
          const { data: inst } = await supabaseAdmin
            .from("whatsapp_instances")
            .select("provider")
            .eq("barbershop_id", rule.barbershop_id)
            .maybeSingle();
          const isMeta = inst?.provider === "meta";

          // Janela de busca: scheduled_at tal que o momento ideal de
          // disparo (scheduled_at - offset) caiu entre
          // (agora - GRACE_MINUTES) e agora.
          const cutoff = new Date(now.getTime() + rule.offset_minutes * 60_000).toISOString();
          const lookbackFloor = new Date(
            now.getTime() - GRACE_MINUTES * 60_000 + rule.offset_minutes * 60_000,
          ).toISOString();

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

            // ACHADO DE BUG REAL Nº 2 (mesmo caso de produção): a ordem
            // antiga era criar o job PRIMEIRO e só depois registrar em
            // agenda_reminder_sent_log — sem checar erro nesse segundo
            // passo. Toda vez que esse registro falhava por algum
            // motivo (visto em produção: dezenas de jobs criados pro
            // MESMO agendamento+regra, um atrás do outro, mas só UM
            // registro de log no fim), a rodada seguinte não tinha como
            // saber que já tinha tentado, e criava outro job de novo —
            // podendo mandar a MESMA mensagem várias vezes de verdade
            // pro cliente.
            //
            // Correção: inverte a ordem. Tenta reservar o registro de
            // log PRIMEIRO (índice único em (appointment_id, rule_id)
            // no banco garante isso de verdade, não só na aplicação).
            // Se already existir (choque de índice único), foi outra
            // rodada que já pegou esse — pula sem criar nada. Só depois
            // de reservar com sucesso é que cria o job de verdade.
            const { data: claimed, error: claimErr } = await supabaseAdmin
              .from("agenda_reminder_sent_log")
              .insert({ appointment_id: appt.id, rule_id: rule.id })
              .select("id")
              .single();
            if (claimErr) {
              if (claimErr.code !== "23505") {
                // 23505 = violação de índice único (já reservado por
                // outra rodada) — esperado, não é erro de verdade.
                // Qualquer outro código aqui é problema real.
                console.error("[evaluate-agenda-reminders] falha ao reservar log:", claimErr.message);
              }
              continue;
            }
            if (!claimed) continue;

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
              primeiro_nome: (customer.name || "").trim().split(/\s+/)[0] || "",
              data: dt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
              hora: dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }),
              servico: serviceName,
              profissional: professionalName,
            };

            // Modelo aprovado (com botão) é exclusivo da API oficial —
            // fora dela, ou quando a regra não usa modelo, cai pra texto
            // livre. Lembrete e confirmação usam a MESMA função agora —
            // sem instrução extra grudada no fim, é exatamente o texto
            // que foi escrito na regra, com as variáveis substituídas.
            const usesTemplate = rule.kind === "confirmation" ? isMeta : !!rule.template_name;
            const freeText = renderAgendaReminderText(rule.message_text || "", vars);
            const { data: job, error: jobErr } = await supabaseAdmin
              .from("message_jobs")
              .insert({
                barbershop_id: rule.barbershop_id,
                customer_id: appt.customer_id,
                phone: customer.phone,
                rendered_body: usesTemplate ? `[Modelo: ${rule.template_name}]` : freeText,
                template_name: usesTemplate ? rule.template_name : null,
                template_language: usesTemplate ? rule.template_language : null,
                template_header_media_path: usesTemplate ? rule.template_header_media_path : null,
                status: "pending",
                scheduled_for: now.toISOString(),
                expires_at: new Date(now.getTime() + 48 * 3600_000).toISOString(),
                appointment_id: appt.id,
                agenda_reminder_rule_id: rule.id,
              })
              .select("id")
              .single();
            if (jobErr || !job) {
              // Já reservamos o log, mas não conseguimos criar o job —
              // apaga a reserva pra não bloquear pra sempre uma futura
              // tentativa (sem isso, esse agendamento nunca mais
              // receberia essa regra, mesmo que o erro tenha sido
              // transitório).
              console.error("[evaluate-agenda-reminders] falha ao criar job, desfazendo reserva do log:", jobErr?.message);
              await supabaseAdmin.from("agenda_reminder_sent_log").delete().eq("id", claimed.id);
              continue;
            }
            await supabaseAdmin.from("agenda_reminder_sent_log").update({ message_job_id: job.id }).eq("id", claimed.id);
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
