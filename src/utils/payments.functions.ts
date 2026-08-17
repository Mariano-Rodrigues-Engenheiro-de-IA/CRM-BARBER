import { createServerFn } from "@tanstack/react-start";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";
import { hashToken } from "@/lib/extension-auth";
import { priceIdForPlan, type PlanId, priceIdForAiAddonPlan, type AiAddonPlanId } from "@/lib/billing";

type CheckoutResult = { clientSecret: string } | { error: string };

function normalizePhone(input: string): string {
  return input.replace(/\D+/g, "");
}

/** Variações BR (com/sem 55, com/sem nono dígito) pra casar com o cadastro. */
function phoneCandidates(phone: string): string[] {
  const set = new Set([phone]);
  const national = phone.startsWith("55") ? phone.slice(2) : phone;
  if (national.length >= 10 && national.length <= 11) {
    const ddd = national.slice(0, 2);
    const local = national.slice(2);
    const with9 = local.length === 8 ? `${ddd}9${local}` : national;
    const without9 = local.length === 9 && local.startsWith("9") ? `${ddd}${local.slice(1)}` : national;
    [with9, without9].forEach((v) => {
      set.add(v);
      set.add(`55${v}`);
    });
  }
  return [...set];
}

/** Resolve a barbearia pelo token da extensão, id direto, telefone ou e-mail. */
async function resolveBarbershop(input: {
  token?: string;
  barbershopId?: string;
  phone?: string;
  email?: string;
  name?: string;
}) {
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

  const phone = input.phone ? normalizePhone(input.phone) : "";
  if (phone.length >= 8) {
    const { data } = await supabaseAdmin
      .from("barbershops")
      .select("id")
      .in("owner_phone", phoneCandidates(phone))
      .limit(1)
      .maybeSingle();
    if (data) return data.id;
  }

  const email = input.email?.trim().toLowerCase();
  if (email) {
    const { data } = await supabaseAdmin
      .from("barbershops")
      .select("id")
      .eq("owner_email", email)
      .maybeSingle();
    if (data) return data.id;
  }

  // Venda por link direto: cria a barbearia agora, para o webhook ter onde gravar.
  if (phone.length >= 8) {
    const { data } = await supabaseAdmin
      .from("barbershops")
      .insert({
        name: input.name?.trim() || "Barbearia",
        owner_name: input.name?.trim() || null,
        owner_phone: phone,
        owner_email: email ?? null,
      })
      .select("id")
      .single();
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
      phone?: string;
      email?: string;
      name?: string;
      plan?: PlanId;
      returnUrl: string;
      environment: StripeEnv;
    }) => {
      if (data.barbershopId && !/^[0-9a-fA-F-]{36}$/.test(data.barbershopId)) {
        throw new Error("Invalid barbershopId");
      }
      if (data.plan && data.plan !== "premium" && data.plan !== "promo") {
        throw new Error("Invalid plan");
      }
      return data;
    },
  )
  .handler(async ({ data }): Promise<CheckoutResult> => {
    const barbershopId = await resolveBarbershop(data);
    if (!barbershopId) {
      return { error: "Informe o WhatsApp da barbearia para identificarmos sua conta." };
    }

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: shop } = await supabaseAdmin
        .from("barbershops")
        .select("owner_email")
        .eq("id", barbershopId)
        .maybeSingle();

      const stripe = createStripeClient(data.environment);
      const lookupKey = priceIdForPlan(data.plan ?? "premium");
      const prices = await stripe.prices.list({ lookup_keys: [lookupKey] });
      if (!prices.data.length) return { error: `Preço não encontrado (${lookupKey})` };
      const price = prices.data[0];

      const email = shop?.owner_email ?? data.email?.trim().toLowerCase() ?? undefined;
      const customerId = await resolveCustomer(stripe, barbershopId, email);

      const session = await stripe.checkout.sessions.create({
        line_items: [{ price: price.id, quantity: 1 }],
        mode: "subscription",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        customer: customerId,
        metadata: { barbershop_id: barbershopId, plan: data.plan ?? "premium" },
        subscription_data: { metadata: { barbershop_id: barbershopId } },
      });

      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

/** Checkout do add-on do Agente de IA — independente do plano do CRM
 * (Grátis ou Premium podem comprar), mesma lógica de resolução de
 * barbearia/cliente do checkout premium. */
export const createAiAddonCheckout = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      token?: string;
      barbershopId?: string;
      phone?: string;
      email?: string;
      name?: string;
      plan: AiAddonPlanId;
      returnUrl: string;
      environment: StripeEnv;
    }) => {
      if (data.barbershopId && !/^[0-9a-fA-F-]{36}$/.test(data.barbershopId)) {
        throw new Error("Invalid barbershopId");
      }
      if (data.plan !== "ai_monthly" && data.plan !== "ai_semestral") {
        throw new Error("Invalid plan");
      }
      return data;
    },
  )
  .handler(async ({ data }): Promise<CheckoutResult> => {
    const barbershopId = await resolveBarbershop(data);
    if (!barbershopId) {
      return { error: "Informe o WhatsApp da barbearia para identificarmos sua conta." };
    }

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: shop } = await supabaseAdmin
        .from("barbershops")
        .select("owner_email")
        .eq("id", barbershopId)
        .maybeSingle();

      const stripe = createStripeClient(data.environment);
      const lookupKey = priceIdForAiAddonPlan(data.plan);
      const prices = await stripe.prices.list({ lookup_keys: [lookupKey] });
      if (!prices.data.length) return { error: `Preço não encontrado (${lookupKey})` };
      const price = prices.data[0];

      const email = shop?.owner_email ?? data.email?.trim().toLowerCase() ?? undefined;
      const customerId = await resolveCustomer(stripe, barbershopId, email);

      const session = await stripe.checkout.sessions.create({
        line_items: [{ price: price.id, quantity: 1 }],
        mode: "subscription",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        customer: customerId,
        metadata: { barbershop_id: barbershopId, plan: data.plan, product: "ai_addon" },
        subscription_data: { metadata: { barbershop_id: barbershopId, product: "ai_addon" } },
      });

      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });
