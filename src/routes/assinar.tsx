import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { createPremiumCheckout } from "@/utils/payments.functions";
import { PaymentTestModeBanner } from "@/components/payment-test-mode-banner";
import { PREMIUM_PRICE_LABEL, PROMO_PRICE_LABEL, labelForPlan, type PlanId } from "@/lib/billing";
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
// Guardado aqui assim que o checkout e criado (mesmo sem a extensao, via
// formulario), pra reconhecer o mesmo navegador numa proxima visita sem
// pedir nome/e-mail/telefone de novo - sem isso, cliente pagante via
// formulario (nunca instalou a extensao) via o formulario toda vez que
// voltasse no mesmo link.
const SHOP_KEY = "crm_checkout_shop_v1";

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
  // true só quando a identidade veio de token/shop já salvo (navegador
  // conhecido) - nesse caso pula direto pro checkout, sem mostrar
  // nome/WhatsApp de novo pra quem já é cliente.
  const [knownBrowser, setKnownBrowser] = useState(false);
  // Sem tela separada: nome e WhatsApp ficam na MESMA pagina do checkout,
  // ao mesmo tempo, pedido do Mariano. O checkout so acende quando o
  // WhatsApp fica valido (nao precisa de botao "continuar" - so digitar).
  // E-mail sai do formulario: a propria Stripe pergunta isso na tela dela,
  // sem risco de nome errado (diferente do nome, que puxaria o nome de
  // quem esta no CARTAO caso a Stripe coletasse - por isso nome continua
  // aqui, pedido explicitamente pelo Mariano).
  const [form, setForm] = useState({ name: "", phone: "" });
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const planParam = url.searchParams.get("plano");
    // Premium (R$ 197) é o plano padrão; os demais só saem por link explícito.
    const validPlans: PlanId[] = ["premium", "promo", "premium_197", "premium_297"];
    setPlan(validPlans.includes(planParam as PlanId) ? (planParam as PlanId) : "premium_197");

    const stored = localStorage.getItem(TOKEN_KEY);
    const token =
      url.searchParams.get("token") ?? (stored && stored.startsWith("ext_") ? stored : undefined);
    const barbershopId =
      url.searchParams.get("shop") ?? localStorage.getItem(SHOP_KEY) ?? undefined;
    if (token || barbershopId) {
      setIdentity({ token: token ?? undefined, barbershopId });
      setKnownBrowser(true);
    }
  }, []);

  useEffect(() => {
    if (identity) return; // já identificado (token/shop salvo) - não mexe
    const allowedCharsOnly = /^[\d\s()+-]+$/.test(form.phone);
    const digits = form.phone.replace(/\D+/g, "");
    const validLength = digits.length === 10 || digits.length === 11;
    if (!form.phone) {
      setPhoneError(null);
      return;
    }
    if (!allowedCharsOnly || !validLength) {
      setPhoneError("Confira o número - deve ter DDD + telefone (10 ou 11 dígitos), sem letra.");
      return;
    }
    setPhoneError(null);
    // Pequena espera pra não disparar o checkout a cada dígito digitado.
    const t = setTimeout(() => {
      setIdentity({ phone: digits, name: form.name.trim() || undefined });
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.phone, identity]);

  const fetchClientSecret = async (): Promise<string> => {
    setCheckoutError(null);
    try {
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
      try {
        localStorage.setItem(SHOP_KEY, result.barbershopId);
      } catch {
        /* sem localStorage: so nao lembra na proxima visita, checkout segue normal */
      }
      return result.clientSecret;
    } catch (err) {
      // Achado real: sem isso, uma falha aqui deixava a area do checkout
      // completamente em branco, sem nenhuma pista do que aconteceu -
      // parecia "o codigo nao funciona" quando na verdade so faltava
      // mostrar o erro. Agora aparece uma mensagem de verdade na tela.
      const message = err instanceof Error ? err.message : "Não foi possível carregar o checkout.";
      setCheckoutError(message);
      throw err;
    }
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

        {/* DIAGNÓSTICO TEMPORÁRIO, tira depois de achar o problema. Mostra
            o estado real da tela pro Mariano me copiar e colar, sem precisar
            abrir o console do navegador. */}
        <pre className="mt-4 overflow-x-auto rounded-lg border-2 border-yellow-400 bg-yellow-50 p-3 text-[11px] text-yellow-900">
{JSON.stringify(
  {
    knownBrowser,
    identity,
    phoneError,
    checkoutError,
    form,
    // Se isso der erro, a chave de pagamento (VITE_PAYMENTS_CLIENT_TOKEN)
    // nao esta configurada neste ambiente - e essa funcao trava o
    // desenho da tela ANTES do React conseguir mostrar qualquer coisa,
    // por isso nada aparecia e nenhum erro vermelho era mostrado.
    stripeEnv: (() => {
      try {
        return getStripeEnvironment();
      } catch (e) {
        return `ERRO: ${e instanceof Error ? e.message : String(e)}`;
      }
    })(),
  },
  null,
  2,
)}
        </pre>

        {knownBrowser ? (
          <div className="mt-8 min-h-[480px] w-full" id="checkout">
            {checkoutError && (
              <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {checkoutError}
              </p>
            )}
            <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        ) : (
          // Nome e WhatsApp entram como se fossem os PRIMEIROS campos do
          // proprio formulario da Stripe - um unico cartao continuo, sem
          // nenhuma divisoria entre eles e o checkout. Assim que o WhatsApp
          // fica valido, o checkout de verdade aparece logo abaixo, dentro
          // do mesmo cartao (useEffect de debounce acima), sem botao.
          <div className="mx-auto mt-8 max-w-lg rounded-2xl border bg-card p-6 shadow-sm">
            <div className="space-y-4">
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
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
                {phoneError && <p className="text-sm text-red-600">{phoneError}</p>}
              </div>
            </div>

            <div id="checkout" className={identity ? "mt-4 min-h-[480px] w-full" : undefined}>
              {checkoutError && (
                <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {checkoutError}
                </p>
              )}
              {identity && (
                <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
                  <EmbeddedCheckout />
                </EmbeddedCheckoutProvider>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
