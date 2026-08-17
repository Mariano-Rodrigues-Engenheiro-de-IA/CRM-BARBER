import { useEffect, useState } from "react";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { createAiAddonCheckout } from "@/utils/payments.functions";
import { AI_ADDON_MONTHLY_LABEL, AI_ADDON_SEMESTRAL_LABEL, type AiAddonPlanId } from "@/lib/billing";
import { youtubeEmbedUrl } from "@/lib/youtube";

type Api = (path: string, opts?: RequestInit) => Promise<any>;

// Vídeo de vendas explicando o Agente de IA — troca esse link quando o
// Mariano gravar o vídeo definitivo (mesmo padrão simples do banner).
const SALES_VIDEO_URL: string | null = null;

type AiAddonStatus = { active: boolean; status: string | null; current_period_end: string | null };

export function AgenteIaView({ api, token }: { api: Api; token: string | null }) {
  const [addon, setAddon] = useState<AiAddonStatus | null>(null);
  const [checkoutPlan, setCheckoutPlan] = useState<AiAddonPlanId | null>(null);

  async function load() {
    const r = await api("/api/public/extension/billing");
    if (r?.ok) setAddon(r.billing.ai_addon);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!addon) {
    return <p className="text-sm text-neutral-500">Carregando...</p>;
  }

  if (addon.active) {
    return <AiAddonActiveState status={addon} />;
  }

  if (checkoutPlan && token) {
    return (
      <AiAddonCheckout
        plan={checkoutPlan}
        token={token}
        onBack={() => setCheckoutPlan(null)}
      />
    );
  }

  return <AiAddonSalesPage onChoosePlan={setCheckoutPlan} />;
}

function AiAddonActiveState({ status }: { status: AiAddonStatus }) {
  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>
      <h1 className="text-xl font-bold text-white">Seu Agente de IA está ativo</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Um de nossos especialistas vai entrar em contato pra configurar tudo com você — ou já entrou, se a compra foi
        há algum tempo.
      </p>
      {status.current_period_end && (
        <p className="mt-4 text-xs text-neutral-500">
          Renovação em {new Date(status.current_period_end).toLocaleDateString("pt-BR")}
        </p>
      )}
    </div>
  );
}

function AiAddonSalesPage({ onChoosePlan }: { onChoosePlan: (plan: AiAddonPlanId) => void }) {
  const embedUrl = SALES_VIDEO_URL ? youtubeEmbedUrl(SALES_VIDEO_URL) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div
        className="relative overflow-hidden rounded-2xl"
        style={{
          backgroundImage: "url(/academy/banner.jpg)",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="flex min-h-[200px] flex-col justify-center px-6 py-8 md:px-12">
          <span className="mb-3 inline-block w-fit rounded-full bg-brand px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
            Novidade
          </span>
          <h1 className="max-w-md text-2xl font-bold text-white md:text-3xl">Agente de IA para o seu WhatsApp</h1>
          <p className="mt-2 max-w-sm text-sm text-neutral-200">
            Atendimento e agendamento automático, 24h por dia, direto no WhatsApp do seu negócio.
          </p>
        </div>
      </div>

      {embedUrl ? (
        <div className="aspect-video w-full overflow-hidden rounded-2xl">
          <iframe
            src={embedUrl}
            title="Conheça o Agente de IA"
            className="h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-10 text-center">
          <p className="text-sm text-neutral-400">Vídeo de apresentação em breve.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <PlanCard
          label="Mensal"
          price={AI_ADDON_MONTHLY_LABEL}
          onClick={() => onChoosePlan("ai_monthly")}
        />
        <PlanCard
          label="Semestral"
          price={AI_ADDON_SEMESTRAL_LABEL}
          highlight
          onClick={() => onChoosePlan("ai_semestral")}
        />
      </div>
    </div>
  );
}

function PlanCard({
  label,
  price,
  highlight,
  onClick,
}: {
  label: string;
  price: string;
  highlight?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={
        "rounded-2xl border p-6 text-center " +
        (highlight ? "border-brand bg-brand/5" : "border-neutral-200 bg-white")
      }
    >
      {highlight && (
        <span className="mb-2 inline-block rounded-full bg-brand px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          Melhor custo-benefício
        </span>
      )}
      <p className="text-sm font-medium text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-neutral-900">{price}</p>
      <button
        onClick={onClick}
        className="mt-4 w-full rounded-xl bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand-strong"
      >
        Quero ativar
      </button>
    </div>
  );
}

function AiAddonCheckout({ plan, token, onBack }: { plan: AiAddonPlanId; token: string; onBack: () => void }) {
  const fetchClientSecret = async (): Promise<string> => {
    const result = await createAiAddonCheckout({
      data: {
        token,
        plan,
        returnUrl: `${window.location.origin}/agente-ia/retorno?session_id={CHECKOUT_SESSION_ID}`,
        environment: getStripeEnvironment(),
      },
    });
    if ("error" in result) throw new Error(result.error);
    if (!result.clientSecret) throw new Error("Checkout indisponível no momento.");
    return result.clientSecret;
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <button onClick={onBack} className="text-sm text-neutral-500 hover:text-neutral-800">
        ← Voltar
      </button>
      <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
