// ROTA TEMPORÁRIA — configurar lookup_key nos preços R$197/R$297 (sandbox + live).
// Remover após uso. Protegida por header x-setup-token.
import { createFileRoute } from "@tanstack/react-router";
import { createStripeClient, getStripeErrorMessage, type StripeEnv } from "@/lib/stripe.server";

const SETUP_TOKEN = "zaylo-price-setup-9f3k2m";
const TARGETS: Array<{ amount: number; lookupKey: string }> = [
  { amount: 19700, lookupKey: "crm_premium_197" },
  { amount: 29700, lookupKey: "crm_premium_297" },
];

async function configureEnv(env: StripeEnv) {
  const stripe = createStripeClient(env);
  const results: Array<Record<string, unknown>> = [];

  const prices = await stripe.prices.list({ active: true, type: "recurring", limit: 100 });
  for (const t of TARGETS) {
    const match = prices.data.find(
      (p) => p.unit_amount === t.amount && (p.currency === "brl" || p.currency === "usd"),
    );
    if (!match) {
      results.push({ lookupKey: t.lookupKey, status: "not_found", amount: t.amount });
      continue;
    }
    if (match.lookup_key === t.lookupKey) {
      results.push({ lookupKey: t.lookupKey, status: "already_set", priceId: match.id });
      continue;
    }
    const updated = await stripe.prices.update(match.id, { lookup_key: t.lookupKey });
    results.push({ lookupKey: t.lookupKey, status: "updated", priceId: updated.id });
  }

  // Confirmação: buscar pelos lookup_keys
  const verify = await stripe.prices.list({
    lookup_keys: TARGETS.map((t) => t.lookupKey),
    limit: 10,
  });
  return {
    env,
    results,
    verified: verify.data.map((p) => ({
      id: p.id,
      lookup_key: p.lookup_key,
      unit_amount: p.unit_amount,
      currency: p.currency,
    })),
  };
}

export const Route = createFileRoute("/api/public/tmp-price-setup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (request.headers.get("x-setup-token") !== SETUP_TOKEN) {
          return new Response("Unauthorized", { status: 401 });
        }
        const out: Record<string, unknown> = {};
        for (const env of ["sandbox", "live"] as StripeEnv[]) {
          try {
            out[env] = await configureEnv(env);
          } catch (e) {
            out[env] = { error: getStripeErrorMessage(e) };
          }
        }
        return Response.json(out, { status: 200 });
      },
    },
  },
});
