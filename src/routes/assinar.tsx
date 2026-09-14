import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { createPremiumCheckout } from "@/utils/payments.functions";
import { PaymentTestModeBanner } from "@/components/payment-test-mode-banner";
import { PREMIUM_PRICE_LABEL, PROMO_PRICE_LABEL, labelForPlan, type PlanId } from "@/lib/billing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/assinar")({
  head: () => ({
    meta: [
      { title: "Zaylo CRM" },
      {
        name: "description",
        content:
          "O CRM completo com IA, disparos, follow-up automático, agenda, funis e organização total do seu atendimento.",
      },
      { property: "og:title", content: "Zaylo CRM" },
      {
        property: "og:description",
        content:
          "O CRM completo com IA, disparos, follow-up automático, agenda, funis e organização total do seu atendimento.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Assinar,
});

const TOKEN_KEY = "crm_ext_token_v1";

type Identity = {
  token?: string;
  barbershopId?: string;
  phone?: string;
  email?: string;
  name?: string;
};

function Assinar() {
  const [plan, setPlan] = useState<PlanId>("premium");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "" });

  useEffect(() => {
    const url = new URL(window.location.href);
    const planParam = url.searchParams.get("plano");
    // Premium (R$ 97) é o plano padrão; os demais só saem por link explícito.
    const validPlans: PlanId[] = ["premium", "promo", "premium_197", "premium_297"];
    setPlan(validPlans.includes(planParam as PlanId) ? (planParam as PlanId) : "premium");

    const stored = localStorage.getItem(TOKEN_KEY);
    const token =
      url.searchParams.get("token") ?? (stored && stored.startsWith("ext_") ? stored : undefined);
    const barbershopId = url.searchParams.get("shop") ?? undefined;
    if (token || barbershopId) setIdentity({ token: token ?? undefined, barbershopId });
  }, []);

  const fetchClientSecret = async (): Promise<string> => {
    const result = await createPremiumCheckout({
      data: {
        ...(identity ?? {}),
        plan,
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
        <h1 className="text-2xl font-semibold tracking-tight">Zaylo CRM</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {plan === "promo" ? (
            <>
              Oferta especial: <strong>{PROMO_PRICE_LABEL}</strong> (valor normal{" "}
              {PREMIUM_PRICE_LABEL}) · IA, disparos, follow-up automático, agenda, funis e
              organização, tudo ilimitado.
            </>
          ) : (
            <>
              {labelForPlan(plan)} · IA, disparos, follow-up automático, agenda, funis e
              organização, tudo ilimitado.
            </>
          )}
        </p>

        {identity ? (
          <div className="mt-8" id="checkout">
            <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        ) : (
          <form
            className="mt-8 max-w-md space-y-4 rounded-2xl border p-6"
            onSubmit={(e) => {
              e.preventDefault();
              const phone = form.phone.replace(/\D+/g, "");
              if (phone.length < 10) return;
              setIdentity({
                phone,
                email: form.email.trim() || undefined,
                name: form.name.trim() || undefined,
              });
            }}
          >
            <p className="text-sm text-muted-foreground">
              Informe o WhatsApp da empresa. É por ele que a extensão libera o Premium.
            </p>
            <div className="space-y-2">
              <Label htmlFor="name">Nome da empresa</Label>
              <Input
                id="name"
                value={form.name}
                maxLength={120}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                maxLength={255}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">WhatsApp (com DDD)</Label>
              <Input
                id="phone"
                type="tel"
                required
                maxLength={20}
                placeholder="ex: 11 99999-0000"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <Button type="submit" size="lg" className="w-full">
              Ir para o pagamento
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
