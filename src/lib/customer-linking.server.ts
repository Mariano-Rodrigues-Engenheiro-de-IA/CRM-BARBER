// Garante um customer_id de verdade pro card (message_jobs exige um, e
// é uma fonte melhor de nome do que o telefone cru) — muitos leads
// vindos direto do WhatsApp não têm um vinculado ainda. Reaproveita um
// cliente já existente com esse telefone, ou cria um (arquivado, pra
// não poluir a lista de clientes ativos com leads que só passaram por
// um funil automatizado).

import type { SupabaseClient } from "@supabase/supabase-js";

export async function ensureCustomerId(
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
