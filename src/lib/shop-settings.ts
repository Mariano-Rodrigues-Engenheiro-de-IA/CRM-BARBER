// Configurações locais da barbearia (por shopId) usadas pelo painel:
// catálogo de planos (nome + valor) e meta mensal de assinantes.
//
// Ficam em localStorage porque são preferências do painel do dono — não
// precisam de sincronização entre dispositivos no MVP.

export type Plan = { name: string; priceCents: number };

const PLANS_KEY = (shopId: string) => `crm_plans_${shopId || "default"}`;
const GOAL_KEY = (shopId: string) => `crm_goal_${shopId || "default"}`;

export function normalizePlanName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 34);
}

export function readPlans(shopId: string): Plan[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(PLANS_KEY(shopId)) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((p) => p && typeof p.name === "string")
      .map((p) => ({ name: String(p.name), priceCents: Number(p.priceCents) || 0 }));
  } catch {
    return [];
  }
}

export function writePlans(shopId: string, plans: Plan[]) {
  localStorage.setItem(PLANS_KEY(shopId), JSON.stringify(plans));
}

/** Junta planos já cadastrados com os detectados na planilha (preço 0 = a definir). */
export function mergeDetectedPlans(shopId: string, detected: string[]) {
  const current = readPlans(shopId);
  const known = new Set(current.map((p) => normalizePlanName(p.name)));
  const next = [...current];
  for (const name of detected) {
    const key = normalizePlanName(name);
    if (!key || known.has(key)) continue;
    known.add(key);
    next.push({ name, priceCents: 0 });
  }
  if (next.length !== current.length) writePlans(shopId, next);
  return next;
}

export function priceOf(plans: Plan[], planName: string | null): number {
  if (!planName) return 0;
  const key = normalizePlanName(planName);
  return plans.find((p) => normalizePlanName(p.name) === key)?.priceCents ?? 0;
}

export function formatBRL(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function readGoal(shopId: string): number {
  if (typeof window === "undefined") return 0;
  return Number(localStorage.getItem(GOAL_KEY(shopId)) || 0) || 0;
}

export function writeGoal(shopId: string, goal: number) {
  localStorage.setItem(GOAL_KEY(shopId), String(Math.max(0, Math.round(goal))));
}
