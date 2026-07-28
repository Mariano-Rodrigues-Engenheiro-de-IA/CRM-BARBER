import { createServerFn } from "@tanstack/react-start";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";
import { hashToken } from "@/lib/extension-auth";

type CheckoutResult = { clientSecret: string } | { error: string };

/** Resolve a barbearia a partir do token da extensão (preferido) ou do id direto. */
async function resolveBarbershop(input: { token?: string; barbershopId?: string }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (input.token) {
    const { data } = await supabaseAdmin
      .from("extension_tokens")
      .select("barbershop_id, revoked_at")
      .eq("token_hash", await hashToken(input.token))
      .maybeSingle();
    if (data && !data.revoked_at) return data.barbershop_id;
  }
  if (input.barbershopId) {
    const { data } = await supabaseAdmin
      .from("barbershops")
      .select("id")
      .eq("id", input.barbershopId)
      .maybeSingle();
    if (data) return data.id;
  }
  return null;
}

async function resolveCustomer(
  stripe: ReturnType<typeof createStripeClient>,
  barbershopId: string,
  email?: string,
) {
  const found = await stripe.customers.search({
    query: `metadata['barbershop_id']:'${barbershopId}'`,
    limit: 1,
  });
  if (found.data.length) return found.data[0].id;
  const created = await stripe.customers.create({
    ...(email ? { email } : {}),
    metadata: { barbershop_id: barbershopId },
  });
  return created.id;
}

export const createPremiumCheckout = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      token?: string;
      barbershopId?: string;
      returnUrl: string;
      environment: StripeEnv;
    }) => {
      if (data.barbershopId && !/^[0-9a-fA-F-]{36}$/.test(data.barbershopId)) {
        throw new Error("Invalid barbershopId");
      }
      return data;
    },
  )
  .handler(async ({ data }): Promise<CheckoutResult> => {
    const barbershopId = await resolveBarbershop(data);
    if (!barbershopId) return { error: "Não foi possível identificar a barbearia. Abra o painel pela extensão." };

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: shop } = await supabaseAdmin
        .from("barbershops")
        .select("owner_email")
        .eq("id", barbershopId)
        .maybeSingle();

      const stripe = createStripeClient(data.environment);
      const prices = await stripe.prices.list({ lookup_keys: ["crm_premium_monthly"] });
      if (!prices.data.length) return { error: "Preço não encontrado" };
      const price = prices.data[0];

      const customerId = await resolveCustomer(stripe, barbershopId, shop?.owner_email ?? undefined);

      const session = await stripe.checkout.sessions.create({
        line_items: [{ price: price.id, quantity: 1 }],
        mode: "subscription",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        customer: customerId,
        automatic_tax: { enabled: true },
        customer_update: { address: "auto" },
        metadata: { barbershop_id: barbershopId, managed_payments: "false" },
        subscription_data: { metadata: { barbershop_id: barbershopId } },
      });

      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });
