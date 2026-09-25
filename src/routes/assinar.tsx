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
  const [plan, setPlan] = useState<PlanId>("premium_197");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [phoneError, setPhoneError] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const planParam = url.searchParams.get("plano");
    // Premium (R$ 197) é o plano padrão; os demais só saem por link explícito.
    const validPlans: PlanId[] = ["premium", "promo", "premium_197", "premium_297"];
    setPlan(validPlans.includes(planParam as PlanId) ? (planParam as PlanId) : "premium_197");

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
        <h1 className="text-2xl font-semibold tracking-tight">Falta pouco pra liberar tudo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {plan === "promo" ? (
            <>
              Oferta especial: <strong>{PROMO_PRICE_LABEL}</strong> (valor normal{" "}
              {PREMIUM_PRICE_LABEL}). IA de atendimento, disparos em massa, follow-up e pós-venda
              automáticos, agenda com lembrete e Kanban de leads, tudo sem limite.
            </>
          ) : (
            <>
              {labelForPlan(plan)}. IA de atendimento, disparos em massa, follow-up e pós-venda
              automáticos, agenda com lembrete e Kanban de leads, tudo sem limite.
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
              // Achado real: o fix anterior só contava dígitos DEPOIS de
              // tirar tudo que não é número - só isso não bastava, porque
              // "11999990a00" tem 11 dígitos válidos escondidos ali (a
              // letra "a" que sobra some no replace), passando pela
              // checagem mesmo tendo letra misturada de verdade. Agora
              // primeiro rejeita QUALQUER caractere que não seja dígito
              // ou formatação comum (espaço, parênteses, hífen, +) -
              // antes mesmo de contar quantos dígitos sobraram.
              const allowedCharsOnly = /^[\d\s()+-]+$/.test(form.phone);
              const phone = form.phone.replace(/\D+/g, "");
              const validLength = phone.length === 10 || phone.length === 11;
              if (!allowedCharsOnly || !validLength) {
                setPhoneError("Confira o número - deve ter DDD + telefone (10 ou 11 dígitos), sem letra.");
                return;
              }
              setPhoneError(null);
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
                aria-invalid={!!phoneError}
                className={phoneError ? "border-red-500 focus-visible:ring-red-500" : undefined}
                onChange={(e) => {
                  setForm((f) => ({ ...f, phone: e.target.value }));
                  if (phoneError) setPhoneError(null);
                }}
              />
              {phoneError && <p className="text-sm text-red-600">{phoneError}</p>}
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
