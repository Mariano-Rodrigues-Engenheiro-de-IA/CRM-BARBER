// Regras do plano grátis vs Premium (compartilhado client/server).
// Determinístico e sempre validado no servidor — o front usa só pra UI.

export const PREMIUM_PRICE_ID = "crm_premium_monthly";
export const PREMIUM_PRICE_LABEL = "R$ 97/mês";

/** Oferta de lançamento (vagas limitadas). */
export const PROMO_PRICE_ID = "crm_premium_promotional";
export const PROMO_PRICE_LABEL = "R$ 47/mês";

/** Planos de venda direta (link mandado direto pro cliente) — mesmo
 * acesso Premium do CRM, preço diferente. */
export const PREMIUM_197_PRICE_ID = "crm_premium_197";
export const PREMIUM_197_PRICE_LABEL = "R$ 197/mês";
export const PREMIUM_297_PRICE_ID = "crm_premium_297";
export const PREMIUM_297_PRICE_LABEL = "R$ 297/mês";

export type PlanId = "premium" | "promo" | "premium_197" | "premium_297";

export function priceIdForPlan(plan: PlanId): string {
  if (plan === "promo") return PROMO_PRICE_ID;
  if (plan === "premium_197") return PREMIUM_197_PRICE_ID;
  if (plan === "premium_297") return PREMIUM_297_PRICE_ID;
  return PREMIUM_PRICE_ID;
}

export function labelForPlan(plan: PlanId): string {
  if (plan === "promo") return PROMO_PRICE_LABEL;
  if (plan === "premium_197") return PREMIUM_197_PRICE_LABEL;
  if (plan === "premium_297") return PREMIUM_297_PRICE_LABEL;
  return PREMIUM_PRICE_LABEL;
}

// Add-on do Agente de IA — independente do plano do CRM (Grátis ou
// Premium podem comprar), soma em cima do que já é pago.
export const AI_ADDON_MONTHLY_PRICE_ID = "crm_ai_addon_monthly";
export const AI_ADDON_MONTHLY_LABEL = "R$ 347/mês";
export const AI_ADDON_SEMESTRAL_PRICE_ID = "crm_ai_addon_semestral";
export const AI_ADDON_SEMESTRAL_LABEL = "R$ 297/mês (cobrado R$ 1.782 a cada 6 meses)";

export type AiAddonPlanId = "ai_monthly" | "ai_semestral";

export function priceIdForAiAddonPlan(plan: AiAddonPlanId): string {
  return plan === "ai_semestral" ? AI_ADDON_SEMESTRAL_PRICE_ID : AI_ADDON_MONTHLY_PRICE_ID;
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
  ai_addon: {
    active: boolean;
    status: string | null;
    current_period_end: string | null;
  };
  ai_access_enabled: boolean;
};

export function remaining(status: BillingStatus, kind: "customers"): number {
  if (status.premium) return Number.POSITIVE_INFINITY;
  return Math.max(0, status.limits[kind] - status.usage[kind]);
}
