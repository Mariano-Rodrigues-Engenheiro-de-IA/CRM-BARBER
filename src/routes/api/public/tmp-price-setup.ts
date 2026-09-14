// ROTA TEMPORÁRIA — criar preços sandbox R$197/R$297 com lookup_key.
// Remover após uso. Protegida por header x-setup-token.
import { createFileRoute } from "@tanstack/react-router";
import { createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";

const SETUP_TOKEN = "zaylo-price-setup-9f3k2m";
const TARGETS: Array<{ amount: number; lookupKey: string }> = [
  { amount: 19700, lookupKey: "crm_premium_197" },
  { amount: 29700, lookupKey: "crm_premium_297" },
];

export const Route = createFileRoute("/api/public/tmp-price-setup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (request.headers.get("x-setup-token") !== SETUP_TOKEN) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const stripe = createStripeClient("sandbox");

          // Produto dono do plano de R$97 (referência do catálogo sandbox)
          const base = await stripe.prices.list({ lookup_keys: ["crm_premium_monthly"] });
          if (!base.data.length) {
            return Response.json({ error: "Preço base crm_premium_monthly não encontrado no sandbox" });
          }
          const productId = typeof base.data[0].product === "string"
            ? base.data[0].product
            : base.data[0].product.id;

          const results: Array<Record<string, unknown>> = [];
          for (const t of TARGETS) {
            const existing = await stripe.prices.list({ lookup_keys: [t.lookupKey] });
            if (existing.data.length) {
              results.push({ lookupKey: t.lookupKey, status: "already_exists", priceId: existing.data[0].id });
              continue;
            }
            const created = await stripe.prices.create({
              product: productId,
              currency: "brl",
              unit_amount: t.amount,
              recurring: { interval: "month" },
              lookup_key: t.lookupKey,
            });
            results.push({ lookupKey: t.lookupKey, status: "created", priceId: created.id });
          }

          const verify = await stripe.prices.list({
            lookup_keys: TARGETS.map((t) => t.lookupKey),
            limit: 10,
          });
          return Response.json({
            productId,
            results,
            verified: verify.data.map((p) => ({
              id: p.id,
              lookup_key: p.lookup_key,
              unit_amount: p.unit_amount,
              currency: p.currency,
            })),
          });
        } catch (e) {
          return Response.json({ error: getStripeErrorMessage(e) }, { status: 500 });
        }
      },
    },
  },
});
