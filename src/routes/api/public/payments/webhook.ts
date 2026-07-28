// Webhook de pagamentos (Stripe) — assinatura verificada por HMAC.
// Caminho obrigatório: /api/public/payments/webhook

import { createFileRoute } from "@tanstack/react-router";
import { type StripeEnv, verifyWebhook } from "@/lib/stripe.server";

function priceIdOf(item: any): string | null {
  return item?.price?.lookup_key || item?.price?.metadata?.lovable_external_id || item?.price?.id || null;
}

async function upsertSubscription(subscription: any, env: StripeEnv) {
  const barbershopId = subscription.metadata?.barbershop_id;
  if (!barbershopId) {
    console.error("Assinatura sem barbershop_id no metadata", subscription.id);
    return;
  }
  const item = subscription.items?.data?.[0];
  const periodStart = item?.current_period_start ?? subscription.current_period_start;
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("shop_subscriptions").upsert(
    {
      barbershop_id: barbershopId,
      stripe_subscription_id: subscription.id,
      stripe_customer_id:
        typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id,
      product_id: typeof item?.price?.product === "string" ? item.price.product : null,
      price_id: priceIdOf(item),
      status: subscription.status,
      current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: subscription.cancel_at_period_end ?? false,
      environment: env,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_subscription_id" },
  );
}

async function cancelSubscription(subscription: any, env: StripeEnv) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("shop_subscriptions")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env);
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
