import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { youtubeEmbedUrl } from "@/lib/youtube";
import { useCachedFetch } from "@/lib/api-cache";
import { PremiumLock } from "@/components/premium-lock";

type Api = (path: string, opts?: RequestInit) => Promise<any>;

const REVENUE_RANGES = [
  "Até R$ 5.000/mês",
  "R$ 5.001 a R$ 15.000/mês",
  "R$ 15.001 a R$ 30.000/mês",
  "R$ 30.001 a R$ 60.000/mês",
  "Acima de R$ 60.000/mês",
];

/** Página do Agente de IA — dois caminhos:
 *
 * 1) "Configurar grátis": auto-provisiona um tenant no
 *    IA-BARBER-ATENDIMENTO (ponte crm-bridge-access-link) e manda o
 *    cliente pro onboarding de lá, onde ele monta o próprio agente.
 * 2) "Agendar demonstração": caminho pago/concierge que já existia —
 *    formulário de lead, especialista entra em contato, configuração
 *    é feita na IA-BARBER-AGENDA.
 *
 * Se o admin já vinculou a conta paga (accessEnabled) OU o cliente já
 * tem tenant na ATENDIMENTO (freeTenant.found), pula a escolha e mostra
 * direto o botão de acesso certo — nunca os dois ao mesmo tempo. */
export function AgenteIaView({ api }: { api: Api }) {
  const [formOpen, setFormOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const { data: salesVideoUrl } = useCachedFetch<string | null>("agente-ia-video", async () => {
    const r = await api("/api/public/extension/agente-ia-settings");
    return r?.ok ? r.sales_video_url : null;
  });
  const { data: accessEnabled, loading: loadingAccess } = useCachedFetch<boolean>(
    "agente-ia-access",
    async () => {
      const r = await api("/api/public/extension/billing");
      return r?.ok ? Boolean(r.billing?.ai_access_enabled) : false;
    },
  );
  // Checagem de status do caminho grátis — sem create=1, nunca cria
  // tenant sozinha, só pergunta "já existe alguma coisa vinculada?".
  // status=1 garante que a ponte NUNCA gera um link de verdade aqui
  // (achado de bug real: gerar link nessa checagem invalidava o link
  // que o cliente tinha acabado de copiar/clicar, já que o Supabase
  // mata o link anterior toda vez que um novo é emitido).
  const { data: freeTenant, loading: loadingFreeTenant } = useCachedFetch<{
    found: boolean;
    onboarding_completed?: boolean;
  } | null>("agente-ia-free-status", async () => {
    const r = await api("/api/public/extension/agente-ia-free-access-link?status=1");
    if (!r?.ok) return null;
    return { found: !!r.found, onboarding_completed: r.onboarding_completed };
  });

  // Espera saber de verdade o estado dos dois caminhos antes de decidir
  // qual tela mostrar — sem isso, a tela errada aparece por um instante
  // e depois troca.
  if (loadingAccess || loadingFreeTenant) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-300 border-t-brand" />
      </div>
    );
  }

  if (accessEnabled) {
    return <AiAccessGranted api={api} />;
  }

  return (
    <PremiumLock
      title="Agente de IA é um recurso Premium"
      description="Atendimento automático 24h no WhatsApp da sua barbearia. Assine o Premium para liberar."
    />
  );
}

/** Cliente já tem acesso liberado (admin vinculou depois da compra) —
 * botão único que gera um link mágico e abre o painel da IA já logado,
 * sem precisar digitar senha de novo. */
function AiAccessGranted({ api }: { api: Api }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccess() {
    setLoading(true);
    setError(null);
    try {
      const r = await api("/api/public/extension/agente-ia-access-link");
      if (!r?.ok || !r.action_link)
        throw new Error(r?.error || "Não foi possível abrir o acesso agora.");
      window.open(r.action_link, "_blank");
    } catch (e: any) {
      setError(e?.message || "Erro ao gerar acesso");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 rounded-2xl border border-neutral-200 bg-white p-8 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand/10">
        <svg
          viewBox="0 0 24 24"
          width="28"
          height="28"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-brand"
        >
          <rect x="4" y="9" width="16" height="11" rx="2" />
          <path d="M12 9V5" />
          <circle cx="12" cy="3.5" r="1.5" />
          <circle cx="9" cy="14" r="1" />
          <circle cx="15" cy="14" r="1" />
        </svg>
      </div>
      <h1 className="text-xl font-bold text-neutral-900">Seu Agente de IA está pronto 🎉</h1>
      <p className="text-sm text-neutral-500">Clique abaixo para acessar o painel da sua IA.</p>
      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </p>
      )}
      <button
        onClick={handleAccess}
        disabled={loading}
        className="block rounded-xl bg-brand px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50 mx-auto"
      >
        {loading ? "Abrindo..." : "Acessar minha IA"}
      </button>
    </div>
  );
}
