// Regras do plano grátis vs Premium (compartilhado client/server).
// Determinístico e sempre validado no servidor — o front usa só pra UI.

export const PREMIUM_PRICE_ID = "crm_premium_monthly";
export const PREMIUM_PRICE_LABEL = "R$ 97/mês";

export const FREE_LIMITS = {
  /** Máximo de assinantes cadastrados no plano grátis. */
  customers: 25,
  /** Máximo de mensagens enfileiradas/enviadas no total, no plano grátis. */
  messages: 30,
} as const;

export type BillingStatus = {
  premium: boolean;
  status: string | null;
  current_period_end: string | null;
  usage: { customers: number; messages: number };
  limits: { customers: number; messages: number };
};

export function remaining(status: BillingStatus, kind: "customers" | "messages"): number {
  if (status.premium) return Number.POSITIVE_INFINITY;
  return Math.max(0, status.limits[kind] - status.usage[kind]);
}
