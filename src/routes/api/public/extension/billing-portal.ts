// POST /api/public/extension/billing-portal -> gera um link temporário do
// Portal do Cliente da Stripe (gerenciar forma de pagamento, cancelar,
// ver faturas) — usado pelo botão "Gerenciar assinatura" no popup "Minha
// conta" da extensão. Não construímos tela nenhuma pra isso: a própria
// Stripe hospeda a experiência inteira.

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

export const Route = createFileRoute("/api/public/extension/billing-portal")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const shop = auth.token.barbershop_id;

        const { data: sub, error: subErr } = await supabaseAdmin
          .from("shop_subscriptions")
          .select("stripe_customer_id, environment")
          .eq("barbershop_id", shop)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (subErr) return jsonResponse(request, { ok: false, error: subErr.message }, { status: 500 });
        if (!sub?.stripe_customer_id) {
          return jsonResponse(
            request,
            { ok: false, error: "Nenhuma assinatura encontrada ainda pra essa conta." },
            { status: 404 },
          );
        }
        // IDs de cliente de verdade da Stripe sempre começam com "cus_" —
        // assinaturas dadas manualmente (cortesia, sem passar pela
        // Stripe) usam um id fictício tipo "manual_comp_..." só pra
        // preencher a coluna, e a Stripe rejeita isso com um erro técnico
        // feio ("No such customer"). Detecta esse caso ANTES de tentar,
        // com uma mensagem que faz sentido pra quem está usando.
        if (!sub.stripe_customer_id.startsWith("cus_")) {
          return jsonResponse(
            request,
            { ok: false, error: "Essa assinatura foi liberada manualmente (cortesia) e não tem cobrança na Stripe — não há nada pra gerenciar aqui." },
            { status: 422 },
          );
        }

        try {
          const { createStripeClient } = await import("@/lib/stripe.server");
          const env = sub.environment === "sandbox" ? "sandbox" : "live";
          const stripe = createStripeClient(env);
          const session = await stripe.billingPortal.sessions.create({
            customer: sub.stripe_customer_id,
            return_url: "https://crm.zayloia.com/painel",
          });
          return jsonResponse(request, { ok: true, url: session.url });
        } catch (e) {
          const { getStripeErrorMessage } = await import("@/lib/stripe.server");
          return jsonResponse(request, { ok: false, error: getStripeErrorMessage(e) }, { status: 500 });
        }
      },
    },
  },
});
