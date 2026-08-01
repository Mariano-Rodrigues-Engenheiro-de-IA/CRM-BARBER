// Leitura determinística do plano da barbearia (server-only).
// Nunca confia no cliente: todo bloqueio de limite passa por aqui.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { FREE_LIMITS, type BillingStatus } from "@/lib/billing";

const ACTIVE_STATUSES = ["active", "trialing", "past_due"];

export async function getBillingStatus(
  supabaseAdmin: SupabaseClient<Database>,
  barbershopId: string,
): Promise<BillingStatus> {
  const [subRes, customersRes, messagesRes] = await Promise.all([
    supabaseAdmin
      .from("shop_subscriptions")
      .select("status, current_period_end")
      .eq("barbershop_id", barbershopId)
      .order("created_at", { ascending: false })
      .limit(5),
    supabaseAdmin
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("barbershop_id", barbershopId)
      .is("archived_at", null),
    supabaseAdmin
      .from("message_jobs")
      .select("id", { count: "exact", head: true })
      .eq("barbershop_id", barbershopId),
  ]);

  const now = Date.now();
  const active = (subRes.data ?? []).find((row) => {
    const endsAt = row.current_period_end ? new Date(row.current_period_end).getTime() : null;
    if (ACTIVE_STATUSES.includes(row.status)) return endsAt === null || endsAt > now;
    if (row.status === "canceled") return endsAt !== null && endsAt > now;
    return false;
  });

  return {
    premium: Boolean(active),
    status: active?.status ?? null,
    current_period_end: active?.current_period_end ?? null,
    usage: { customers: customersRes.count ?? 0, messages: messagesRes.count ?? 0 },
    limits: { customers: FREE_LIMITS.customers, dispatchBatch: FREE_LIMITS.dispatchBatch },
  };
}

/** Retorna mensagem de bloqueio ou null quando pode seguir (limite de base). */
export function limitBlock(
  status: BillingStatus,
  kind: "customers",
  extra: number,
): string | null {
  if (status.premium) return null;
  const total = status.usage[kind] + extra;
  if (total <= status.limits[kind]) return null;
  return `Plano grátis permite até ${status.limits.customers} contatos (você tem ${status.usage.customers}). Assine o Premium para liberar contatos ilimitados.`;
}

/** Bloqueio de tamanho do disparo: plano grátis envia poucos contatos por vez. */
export function dispatchBlock(status: BillingStatus, targetCount: number): string | null {
  if (status.premium) return null;
  if (targetCount <= status.limits.dispatchBatch) return null;
  return `Plano grátis envia até ${status.limits.dispatchBatch} contatos por disparo (você selecionou ${targetCount}). Assine o Premium para disparos ilimitados.`;
}
