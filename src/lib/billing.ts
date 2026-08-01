// Regras do plano grátis vs Premium (compartilhado client/server).
// Determinístico e sempre validado no servidor — o front usa só pra UI.

export const PREMIUM_PRICE_ID = "crm_premium_monthly";
export const PREMIUM_PRICE_LABEL = "R$ 97/mês";

/** Oferta de lançamento (vagas limitadas). */
export const PROMO_PRICE_ID = "crm_premium_promotional";
export const PROMO_PRICE_LABEL = "R$ 47/mês";

export type PlanId = "premium" | "promo";

export function priceIdForPlan(plan: PlanId): string {
  return plan === "promo" ? PROMO_PRICE_ID : PREMIUM_PRICE_ID;
}

export const FREE_LIMITS = {
  /** Máximo de assinantes/contatos cadastrados no plano grátis. */
  customers: 100,
  /** Máximo de contatos por disparo no plano grátis. */
  dispatchBatch: 5,
} as const;

export type BillingStatus = {
  premium: boolean;
  status: string | null;
  current_period_end: string | null;
  usage: { customers: number; messages: number };
  limits: { customers: number; dispatchBatch: number };
};

export function remaining(status: BillingStatus, kind: "customers"): number {
  if (status.premium) return Number.POSITIVE_INFINITY;
  return Math.max(0, status.limits[kind] - status.usage[kind]);
}
