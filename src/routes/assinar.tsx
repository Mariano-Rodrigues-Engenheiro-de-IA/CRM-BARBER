import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { createPremiumCheckout } from "@/utils/payments.functions";
import { PaymentTestModeBanner } from "@/components/payment-test-mode-banner";
import { PREMIUM_PRICE_LABEL } from "@/lib/billing";

export const Route = createFileRoute("/assinar")({
  head: () => ({
    meta: [
      { title: "Assinar Premium — CRM de Assinaturas" },
      { name: "description", content: "Libere assinantes e disparos ilimitados no CRM da sua barbearia." },
      { property: "og:title", content: "Assinar Premium — CRM de Assinaturas" },
      { property: "og:description", content: "Libere assinantes e disparos ilimitados no CRM da sua barbearia." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Assinar,
});

const TOKEN_KEY = "crm_ext_token_v1";

function Assinar() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useState<{ token?: string; barbershopId?: string }>({});

  useEffect(() => {
    const url = new URL(window.location.href);
    const stored = localStorage.getItem(TOKEN_KEY);
    const token = url.searchParams.get("token") ?? (stored && stored.startsWith("ext_") ? stored : undefined);
    const barbershopId = url.searchParams.get("shop") ?? undefined;
    if (!token && !barbershopId) {
      setError("Abra esta página pelo painel do CRM para identificarmos sua barbearia.");
      return;
    }
    setParams({ token: token ?? undefined, barbershopId });
    setReady(true);
  }, []);

  const fetchClientSecret = async (): Promise<string> => {
    const result = await createPremiumCheckout({
      data: {
        ...params,
        returnUrl: `${window.location.origin}/assinar/retorno?session_id={CHECKOUT_SESSION_ID}`,
        environment: getStripeEnvironment(),
      },
    });
    if ("error" in result) throw new Error(result.error);
    if (!result.clientSecret) throw new Error("Checkout indisponível no momento.");
    return result.clientSecret;
  };

  return (
    <div className="min-h-screen bg-background">
      <PaymentTestModeBanner />
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">CRM Assinaturas Premium</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {PREMIUM_PRICE_LABEL} · assinantes ilimitados, disparos ilimitados, respostas rápidas e campanhas.
        </p>
        {error ? (
          <p className="mt-8 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </p>
        ) : ready ? (
          <div className="mt-8" id="checkout">
            <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        ) : (
          <p className="mt-8 text-sm text-muted-foreground">Carregando…</p>
        )}
      </div>
    </div>
  );
}
