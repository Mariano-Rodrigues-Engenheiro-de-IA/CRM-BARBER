// Lista de assinaturas do CRM para o painel admin (aba "Assinaturas").
// Mostra quem já pagou, com qual plano, e o status real vindo do Stripe
// (via shop_subscriptions, já sincronizado pelo webhook de pagamentos).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  PREMIUM_PRICE_ID,
  PROMO_PRICE_ID,
  PREMIUM_197_PRICE_ID,
  PREMIUM_297_PRICE_ID,
} from "@/lib/billing";

type Admin = SupabaseClient<Database>;

export type AdminSubscriptionRow = {
  barbershop_id: string;
  shop_name: string;
  owner_phone: string | null;
  owner_email: string | null;
  price_id: string | null;
  plan_label: string;
  status: string;
  current_period_end: string | null;
  stripe_customer_id: string | null;
  created_at: string;
};

const PLAN_LABELS: Record<string, string> = {
  [PREMIUM_PRICE_ID]: "Premium (R$ 97)",
  [PROMO_PRICE_ID]: "Promo (R$ 47)",
  [PREMIUM_197_PRICE_ID]: "Venda direta (R$ 197)",
  [PREMIUM_297_PRICE_ID]: "Venda direta (R$ 297)",
};

export async function listSubscriptions(supabaseAdmin: Admin): Promise<AdminSubscriptionRow[]> {
  // Só assinaturas do CRM (exclui add-on de IA, que é um produto separado).
  const crmPriceIds = [
    PREMIUM_PRICE_ID,
    PROMO_PRICE_ID,
    PREMIUM_197_PRICE_ID,
    PREMIUM_297_PRICE_ID,
  ];

  const { data: subs, error } = await supabaseAdmin
    .from("shop_subscriptions")
    .select("barbershop_id, price_id, status, current_period_end, stripe_customer_id, created_at")
    .in("price_id", crmPriceIds)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const shopIds = Array.from(new Set((subs ?? []).map((s) => s.barbershop_id)));
  const { data: shops } = shopIds.length
    ? await supabaseAdmin
        .from("barbershops")
        .select("id, name, owner_phone, owner_email")
        .in("id", shopIds)
    : { data: [] };
  const shopById = new Map((shops ?? []).map((s) => [s.id, s]));

  return (subs ?? []).map((s) => {
    const shop = shopById.get(s.barbershop_id);
    return {
      barbershop_id: s.barbershop_id,
      shop_name: shop?.name ?? "(barbearia não encontrada)",
      owner_phone: shop?.owner_phone ?? null,
      owner_email: shop?.owner_email ?? null,
      price_id: s.price_id,
      plan_label: PLAN_LABELS[s.price_id ?? ""] ?? s.price_id ?? "—",
      status: s.status,
      current_period_end: s.current_period_end,
      stripe_customer_id: s.stripe_customer_id,
      created_at: s.created_at,
    };
  });
}
