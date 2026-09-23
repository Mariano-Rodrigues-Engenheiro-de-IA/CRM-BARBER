// Leitura determinística do plano da barbearia (server-only).
// Nunca confia no cliente: todo bloqueio de limite passa por aqui.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  FREE_LIMITS,
  type BillingStatus,
  PREMIUM_PRICE_ID,
  PROMO_PRICE_ID,
  PREMIUM_197_PRICE_ID,
  PREMIUM_297_PRICE_ID,
  AI_ADDON_MONTHLY_PRICE_ID,
  AI_ADDON_SEMESTRAL_PRICE_ID,
} from "@/lib/billing";

const ACTIVE_STATUSES = ["active", "trialing", "past_due"];

function isRowActive(
  row: { status: string; current_period_end: string | null },
  now: number,
): boolean {
  const endsAt = row.current_period_end ? new Date(row.current_period_end).getTime() : null;
  if (ACTIVE_STATUSES.includes(row.status)) return endsAt === null || endsAt > now;
  if (row.status === "canceled") return endsAt !== null && endsAt > now;
  return false;
}

// Mesmo deslocamento de Brasília usado em send-payment-reminders, sem
// isso, "hoje" bateria à meia-noite UTC (21h no Brasil), cortando o dia
// errado.
const BRAZIL_OFFSET_MS = -3 * 60 * 60 * 1000;

function startOfTodayBrazilIso(): string {
  const now = new Date();
  const brazilNow = new Date(now.getTime() + BRAZIL_OFFSET_MS);
  const startBrazil = Date.UTC(brazilNow.getUTCFullYear(), brazilNow.getUTCMonth(), brazilNow.getUTCDate());
  return new Date(startBrazil - BRAZIL_OFFSET_MS).toISOString();
}

export async function getBillingStatus(
  supabaseAdmin: SupabaseClient<Database>,
  barbershopId: string,
): Promise<BillingStatus> {
  const todayStart = startOfTodayBrazilIso();
  const [subRes, customersRes, messagesRes, shopRes, dispatchTodayRes, agendaTodayRes, professionalsRes] =
    await Promise.all([
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
      supabaseAdmin
        .from("barbershops")
        .select("ai_access_enabled, is_admin")
        .eq("id", barbershopId)
        .maybeSingle(),
      supabaseAdmin
        .from("message_jobs")
        .select("id", { count: "exact", head: true })
        .eq("barbershop_id", barbershopId)
        .eq("status", "sent")
        .gte("sent_at", todayStart),
      supabaseAdmin
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("barbershop_id", barbershopId)
        .gte("created_at", todayStart),
      supabaseAdmin
        .from("professionals")
        .select("id", { count: "exact", head: true })
        .eq("barbershop_id", barbershopId)
        .eq("active", true),
    ]);

  const now = Date.now();
  const allSubs = subRes.data ?? [];
  // Importante: cada "produto" (Premium do CRM vs Add-on de IA) tem seus
  // próprios price_ids — sem esse filtro, uma assinatura do add-on de IA
  // seria contada por engano como Premium do CRM também.
  const crmPriceIds = [
    PREMIUM_PRICE_ID,
    PROMO_PRICE_ID,
    PREMIUM_197_PRICE_ID,
    PREMIUM_297_PRICE_ID,
  ];
  const aiPriceIds = [AI_ADDON_MONTHLY_PRICE_ID, AI_ADDON_SEMESTRAL_PRICE_ID];

  const activeCrm = allSubs.find(
    (row) => crmPriceIds.includes(row.price_id ?? "") && isRowActive(row, now),
  );
  const activeAi = allSubs.find(
    (row) => aiPriceIds.includes(row.price_id ?? "") && isRowActive(row, now),
  );

  // Barbearias admin (cortesia) têm acesso liberado sem assinatura —
  // controlado por is_admin no próprio registro, ligado/desligado pelo
  // painel de Clientes (antes era uma variável de ambiente editada na
  // mão no Lovable).
  const courtesy = Boolean(shopRes.data?.is_admin);
  const premium = courtesy || Boolean(activeCrm);

  return {
    premium,
    status: activeCrm?.status ?? (courtesy ? "courtesy" : null),
    current_period_end: activeCrm?.current_period_end ?? null,
    usage: {
      customers: customersRes.count ?? 0,
      messages: messagesRes.count ?? 0,
      dispatchToday: dispatchTodayRes.count ?? 0,
      agendaToday: agendaTodayRes.count ?? 0,
      professionals: professionalsRes.count ?? 0,
    },
    limits: {
      customers: FREE_LIMITS.customers,
      dispatchBatch: FREE_LIMITS.dispatchBatch,
      dispatchDaily: FREE_LIMITS.dispatchDaily,
      agendaDaily: FREE_LIMITS.agendaDaily,
      professionals: FREE_LIMITS.professionals,
    },
    ai_addon: {
      active: Boolean(activeAi),
      status: activeAi?.status ?? null,
      current_period_end: activeAi?.current_period_end ?? null,
    },
    ai_access_enabled: Boolean(shopRes.data?.ai_access_enabled),
    // Ranking bloqueado por completo no grátis, igual a IA - pedido do
    // Mariano.
    ranking_enabled: premium,
  };
}

/** Retorna mensagem de bloqueio ou null quando pode seguir (limite de base). */
export function limitBlock(status: BillingStatus, kind: "customers", extra: number): string | null {
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

/** Bloqueio de volume diário de disparo. */
export function dispatchDailyBlock(status: BillingStatus, extra: number): string | null {
  if (status.premium) return null;
  const total = status.usage.dispatchToday + extra;
  if (total <= status.limits.dispatchDaily) return null;
  return `Plano grátis envia até ${status.limits.dispatchDaily} mensagens de disparo por dia (você já enviou ${status.usage.dispatchToday} hoje). Assine o Premium para disparos ilimitados.`;
}

/** Bloqueio de agendamentos criados no dia. */
export function agendaDailyBlock(status: BillingStatus): string | null {
  if (status.premium) return null;
  if (status.usage.agendaToday < status.limits.agendaDaily) return null;
  return `Plano grátis permite até ${status.limits.agendaDaily} agendamentos por dia (você já tem ${status.usage.agendaToday} hoje). Assine o Premium para agendamentos ilimitados.`;
}

/** Bloqueio de cadastro de profissional/atendente. */
export function professionalBlock(status: BillingStatus): string | null {
  if (status.premium) return null;
  if (status.usage.professionals < status.limits.professionals) return null;
  return `Plano grátis permite até ${status.limits.professionals} profissional cadastrado. Assine o Premium para adicionar mais atendentes.`;
}
