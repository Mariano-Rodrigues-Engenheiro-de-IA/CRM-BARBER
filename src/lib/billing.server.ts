// Leitura determinística do plano da barbearia (server-only).
// Nunca confia no cliente: todo bloqueio de limite passa por aqui.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { FREE_LIMITS, type BillingStatus, PREMIUM_PRICE_ID, PROMO_PRICE_ID, AI_ADDON_MONTHLY_PRICE_ID, AI_ADDON_SEMESTRAL_PRICE_ID } from "@/lib/billing";
import { isAdminBarbershop } from "@/lib/admin-guard.server";

const ACTIVE_STATUSES = ["active", "trialing", "past_due"];

function isRowActive(row: { status: string; current_period_end: string | null }, now: number): boolean {
  const endsAt = row.current_period_end ? new Date(row.current_period_end).getTime() : null;
  if (ACTIVE_STATUSES.includes(row.status)) return endsAt === null || endsAt > now;
  if (row.status === "canceled") return endsAt !== null && endsAt > now;
  return false;
}

export async function getBillingStatus(
  supabaseAdmin: SupabaseClient<Database>,
  barbershopId: string,
): Promise<BillingStatus> {
  const [subRes, customersRes, messagesRes, shopRes] = await Promise.all([
    supabaseAdmin
      .from("shop_subscriptions")
      .select("status, current_period_end, price_id")
      .eq("barbershop_id", barbershopId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabaseAdmin
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("barbershop_id", barbershopId)
      .is("archived_at", null),
    supabaseAdmin
      .from("message_jobs")
      .select("id", { count: "exact", head: true })
      .eq("barbershop_id", barbershopId),
    supabaseAdmin.from("barbershops").select("ai_access_enabled").eq("id", barbershopId).maybeSingle(),
  ]);

  const now = Date.now();
  const allSubs = subRes.data ?? [];
  // Importante: cada "produto" (Premium do CRM vs Add-on de IA) tem seus
  // próprios price_ids — sem esse filtro, uma assinatura do add-on de IA
  // seria contada por engano como Premium do CRM também.
  const crmPriceIds = [PREMIUM_PRICE_ID, PROMO_PRICE_ID];
  const aiPriceIds = [AI_ADDON_MONTHLY_PRICE_ID, AI_ADDON_SEMESTRAL_PRICE_ID];

  const activeCrm = allSubs.find((row) => crmPriceIds.includes(row.price_id ?? "") && isRowActive(row, now));
  const activeAi = allSubs.find((row) => aiPriceIds.includes(row.price_id ?? "") && isRowActive(row, now));

  // Barbearias admin (cortesia) têm acesso liberado sem assinatura.
  const courtesy = isAdminBarbershop(barbershopId);

  return {
    premium: courtesy || Boolean(activeCrm),
    status: activeCrm?.status ?? (courtesy ? "courtesy" : null),
    current_period_end: activeCrm?.current_period_end ?? null,
    usage: { customers: customersRes.count ?? 0, messages: messagesRes.count ?? 0 },
    limits: { customers: FREE_LIMITS.customers, dispatchBatch: FREE_LIMITS.dispatchBatch },
    ai_addon: {
      active: Boolean(activeAi),
      status: activeAi?.status ?? null,
      current_period_end: activeAi?.current_period_end ?? null,
    },
    ai_access_enabled: Boolean(shopRes.data?.ai_access_enabled),
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
