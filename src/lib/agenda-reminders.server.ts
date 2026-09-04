// Detecção de confirmação por texto digitado — compartilhada entre o
// webhook da Meta (API oficial) e o da uazapi (API não oficial). Cada
// um resolve o barbershop_id à sua própria maneira (a Meta usa
// phone_number_id, a uazapi usa o token da instância) e depois chama a
// mesma lógica daqui pra frente — evita duplicar a consulta de
// candidatos e a checagem de palavra-chave em dois arquivos.

/** Casa uma resposta DIGITADA (não clique em botão) com a confirmação
 * pendente mais recente daquele número de telefone — não tem WAMID de
 * contexto pra casar direto, então usa telefone + "ainda não
 * confirmado" + janela de tempo recente. Se o texto bater com alguma
 * palavra configurada na regra (sim, ok, confirmo...), confirma. */
export async function handleConfirmationTextReplyForBarbershop(
  barbershopId: string,
  fromPhone: string,
  text: string,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { textMatchesConfirmKeywords } = await import("@/lib/agenda-reminders");

  const normalizedPhone = fromPhone.replace(/\D/g, "");
  const sinceIso = new Date(Date.now() - 48 * 3600_000).toISOString();

  // Confirmação pendente mais recente pra esse telefone: job criado por
  // uma regra de confirmação, enviado (não falho/pendente), dentro da
  // janela de 48h, cujo agendamento ainda não está confirmed.
  const { data: candidates } = await supabaseAdmin
    .from("message_jobs")
    .select("id, appointment_id, agenda_reminder_rule_id, sent_at, appointments!inner(status)")
    .eq("barbershop_id", barbershopId)
    .eq("phone", normalizedPhone)
    .not("agenda_reminder_rule_id", "is", null)
    .not("appointment_id", "is", null)
    .eq("status", "sent")
    .gte("sent_at", sinceIso)
    .order("sent_at", { ascending: false })
    .limit(5);
  if (!candidates?.length) return false;

  for (const job of candidates) {
    const appt = job.appointments as unknown as { status: string } | null;
    if (appt?.status === "confirmed") continue; // já confirmado, ignora
    const { data: rule } = await supabaseAdmin
      .from("agenda_reminder_rules")
      .select("kind, confirm_keywords")
      .eq("id", job.agenda_reminder_rule_id as string)
      .maybeSingle();
    if (rule?.kind !== "confirmation") continue;
    const keywords = (rule.confirm_keywords as string[] | null) || [];
    if (!keywords.length || !textMatchesConfirmKeywords(text, keywords)) continue;
    await confirmAppointment(job.appointment_id as string, "texto digitado");
    return true; // só a confirmação mais recente que bateu, não continua olhando as outras
  }
  return false;
}

export async function confirmAppointment(appointmentId: string, via: "botão" | "texto digitado") {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("appointments")
    .update({ status: "confirmed" })
    .eq("id", appointmentId);
  if (error) {
    console.error(`[agenda-reminders] falha ao confirmar agendamento via ${via}:`, error.message);
  } else {
    console.info(`[agenda-reminders] agendamento confirmado via ${via}:`, appointmentId);
  }
}
