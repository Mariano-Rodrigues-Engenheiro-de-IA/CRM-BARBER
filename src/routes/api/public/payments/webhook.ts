// Webhook de pagamentos (Stripe) — assinatura verificada por HMAC.
// Caminho obrigatório: /api/public/payments/webhook

import { createFileRoute } from "@tanstack/react-router";
import { type StripeEnv, verifyWebhook } from "@/lib/stripe.server";
import {
  PREMIUM_197_PRICE_ID,
  PREMIUM_297_PRICE_ID,
  AI_ADDON_MONTHLY_PRICE_ID,
  AI_ADDON_SEMESTRAL_PRICE_ID,
} from "@/lib/billing";

// Planos que passam a incluir o Agente de IA empacotado (R$197 e
// R$297) - decisao do Mariano, antes a IA era so add-on avulso.
const AI_BUNDLED_PRICE_IDS = [PREMIUM_197_PRICE_ID, PREMIUM_297_PRICE_ID];
const AI_ADDON_PRICE_IDS = [AI_ADDON_MONTHLY_PRICE_ID, AI_ADDON_SEMESTRAL_PRICE_ID];

function priceIdOf(item: any): string | null {
  return item?.price?.lookup_key || item?.price?.metadata?.lovable_external_id || item?.price?.id || null;
}

// Fallback de vínculo: assinaturas antigas (ou criadas fora do fluxo do CRM)
// chegam sem barbershop_id no metadata. Antes de descartar, tentamos achar a
// barbearia (1) por outra assinatura do mesmo cliente Stripe e (2) pelo e-mail
// do cliente no Stripe comparado ao owner_email da barbearia.
async function resolveBarbershopId(subscription: any, env: StripeEnv): Promise<string | null> {
  const fromMetadata = subscription.metadata?.barbershop_id;
  if (fromMetadata) return fromMetadata;

  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
  if (!customerId) return null;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: known } = await supabaseAdmin
    .from("shop_subscriptions")
    .select("barbershop_id")
    .eq("stripe_customer_id", customerId)
    .limit(1)
    .maybeSingle();
  if (known?.barbershop_id) return known.barbershop_id;

  try {
    const { createStripeClient } = await import("@/lib/stripe.server");
    const stripe = createStripeClient(env);
    const customer: any = await stripe.customers.retrieve(customerId);
    const email = customer?.email?.trim().toLowerCase();
    if (!email) return null;
    const { data: shop } = await supabaseAdmin
      .from("barbershops")
      .select("id")
      .ilike("owner_email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return shop?.id ?? null;
  } catch (e) {
    console.error("Falha ao resolver barbearia pelo e-mail do cliente Stripe", e);
    return null;
  }
}

async function upsertSubscription(subscription: any, env: StripeEnv) {
  const barbershopId = await resolveBarbershopId(subscription, env);
  if (!barbershopId) {
    console.error("Assinatura sem barbershop_id no metadata", subscription.id);
    return;
  }

  const item = subscription.items?.data?.[0];
  const periodStart = item?.current_period_start ?? subscription.current_period_start;
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const resolvedPriceId = priceIdOf(item);
  await supabaseAdmin.from("shop_subscriptions").upsert(
    {
      barbershop_id: barbershopId,
      stripe_subscription_id: subscription.id,
      stripe_customer_id:
        typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id,
      product_id: typeof item?.price?.product === "string" ? item.price.product : null,
      price_id: resolvedPriceId,
      status: subscription.status,
      current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: subscription.cancel_at_period_end ?? false,
      environment: env,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_subscription_id" },
  );

  // R$197 e R$297 passam a incluir o Agente de IA empacotado - libera
  // automaticamente quando a assinatura desses planos fica ativa.
  const isActiveLike = ["active", "trialing", "past_due"].includes(subscription.status);
  if (resolvedPriceId && AI_BUNDLED_PRICE_IDS.includes(resolvedPriceId) && isActiveLike) {
    await supabaseAdmin
      .from("barbershops")
      .update({ ai_access_enabled: true })
      .eq("id", barbershopId);
  }
}

async function cancelSubscription(subscription: any, env: StripeEnv) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Busca o barbershop_id e o price_id ANTES de marcar como cancelado,
  // pra saber se precisa reavaliar o acesso a IA.
  const { data: canceledRow } = await supabaseAdmin
    .from("shop_subscriptions")
    .select("barbershop_id, price_id")
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env)
    .maybeSingle();

  await supabaseAdmin
    .from("shop_subscriptions")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env);

  if (!canceledRow?.barbershop_id || !canceledRow.price_id) return;
  if (!AI_BUNDLED_PRICE_IDS.includes(canceledRow.price_id)) return;

  // Antes de desligar a IA, confere se ainda sobra algum motivo pra
  // manter (outro plano empacotado ativo, ou o add-on avulso).
  const { data: remaining } = await supabaseAdmin
    .from("shop_subscriptions")
    .select("price_id, status, current_period_end")
    .eq("barbershop_id", canceledRow.barbershop_id)
    .eq("environment", env)
    .neq("stripe_subscription_id", subscription.id);

  const now = Date.now();
  const stillHasAiAccess = (remaining ?? []).some((row) => {
    const grantsAi = AI_BUNDLED_PRICE_IDS.includes(row.price_id ?? "") || AI_ADDON_PRICE_IDS.includes(row.price_id ?? "");
    if (!grantsAi) return false;
    const endsAt = row.current_period_end ? new Date(row.current_period_end).getTime() : null;
    if (["active", "trialing", "past_due"].includes(row.status)) return endsAt === null || endsAt > now;
    if (row.status === "canceled") return endsAt !== null && endsAt > now;
    return false;
  });

  if (!stillHasAiAccess) {
    await supabaseAdmin
      .from("barbershops")
      .update({ ai_access_enabled: false })
      .eq("id", canceledRow.barbershop_id);
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          return Response.json({ received: true, ignored: "invalid env" });
        }
        const env: StripeEnv = rawEnv;
        try {
          const event = await verifyWebhook(request, env);
          switch (event.type) {
            case "customer.subscription.created":
            case "customer.subscription.updated":
              await upsertSubscription(event.data.object, env);
              break;
            case "customer.subscription.deleted":
              await cancelSubscription(event.data.object, env);
              break;
            default:
              console.log("Evento não tratado:", event.type);
          }
          return Response.json({ received: true });
        } catch (e) {
          console.error("Webhook error:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
