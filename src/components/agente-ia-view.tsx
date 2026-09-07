import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { youtubeEmbedUrl } from "@/lib/youtube";
import { useCachedFetch } from "@/lib/api-cache";

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
  const { data: accessEnabled, loading: loadingAccess } = useCachedFetch<boolean>("agente-ia-access", async () => {
    const r = await api("/api/public/extension/billing");
    return r?.ok ? Boolean(r.billing?.ai_access_enabled) : false;
  });
  // Checagem de status do caminho grátis — sem create=1, nunca cria
  // tenant sozinha, só pergunta "já existe alguma coisa vinculada?".
  const { data: freeTenant, loading: loadingFreeTenant } = useCachedFetch<{ found: boolean; onboarding_completed?: boolean } | null>(
    "agente-ia-free-status",
    async () => {
      const r = await api("/api/public/extension/agente-ia-free-access-link");
      if (!r?.ok) return null;
      return { found: !!r.found, onboarding_completed: r.onboarding_completed };
    },
  );

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

  if (freeTenant?.found) {
    return <FreeAiAccess api={api} onboardingCompleted={!!freeTenant.onboarding_completed} />;
  }

  const embedUrl = salesVideoUrl ? youtubeEmbedUrl(salesVideoUrl) : null;

  if (sent) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-neutral-200 bg-white p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-neutral-900">Ótimo!</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Um de nossos especialistas vai entrar em contato com você pra agendar uma demonstração.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {embedUrl ? (
        <div className="mx-auto aspect-video w-full max-w-2xl overflow-hidden rounded-2xl border-2 border-brand shadow-lg">
          <iframe
            src={embedUrl}
            title="Conheça o Agente de IA"
            className="h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <div className="mx-auto max-w-2xl rounded-2xl border-2 border-dashed border-neutral-300 bg-neutral-50 p-10 text-center">
          <p className="text-sm text-neutral-400">Vídeo de apresentação em breve.</p>
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <FreeSetupCard api={api} />
        <div className="rounded-2xl border-2 border-brand bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand">Feita pela nossa equipe</p>
          <h3 className="mt-2 text-lg font-bold text-neutral-900">Configuração assistida</h3>
          <p className="mt-2 text-sm text-neutral-500">
            Um especialista configura o agente com você numa chamada, já testado e afinado pro seu tipo de negócio.
          </p>
          <button
            onClick={() => setFormOpen(true)}
            className="mt-5 w-full rounded-xl bg-brand py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-brand-strong"
          >
            Agendar demonstração
          </button>
        </div>
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Agendar demonstração</DialogTitle>
          </DialogHeader>
          <DemoForm api={api} onSent={() => { setFormOpen(false); setSent(true); }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Cartão do caminho grátis — clique já dispara a criação do tenant
 * (create=1) e abre o onboarding numa aba nova. */
function FreeSetupCard({ api }: { api: Api }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setLoading(true);
    setError(null);
    try {
      const r = await api("/api/public/extension/agente-ia-free-access-link?create=1");
      if (!r?.ok || !r.action_link) throw new Error(r?.error || "Não foi possível iniciar agora.");
      window.open(r.action_link, "_blank");
      // Recarrega a página depois de abrir — na próxima vez que essa
      // tela carregar, freeTenant.found já vem true e mostra o estado
      // de "configuração em andamento" em vez da escolha de novo.
      window.location.reload();
    } catch (e: any) {
      setError(e?.message || "Erro ao iniciar configuração");
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Grátis</p>
      <h3 className="mt-2 text-lg font-bold text-neutral-900">Configurar por conta própria</h3>
      <p className="mt-2 text-sm text-neutral-500">
        Você mesmo monta o agente, no seu ritmo, com o passo a passo dentro do sistema.
      </p>
      {error && <p className="mt-3 rounded-lg border border-red-300 bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      <button
        onClick={handleStart}
        disabled={loading}
        className="mt-5 w-full rounded-xl border-2 border-neutral-200 bg-white py-2.5 text-sm font-semibold text-neutral-700 hover:border-brand hover:text-brand disabled:opacity-50"
      >
        {loading ? "Abrindo..." : "Começar agora"}
      </button>
    </div>
  );
}

/** Cliente já escolheu o caminho grátis. Se ainda não terminou o
 * onboarding lá, mostra "continuar configuração"; se já terminou,
 * mostra o acesso direto — mesmo padrão visual do AiAccessGranted
 * (pago), só que apontando pra ponte gratuita. */
function FreeAiAccess({ api, onboardingCompleted }: { api: Api; onboardingCompleted: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccess() {
    setLoading(true);
    setError(null);
    try {
      const r = await api("/api/public/extension/agente-ia-free-access-link");
      if (!r?.ok || !r.action_link) throw new Error(r?.error || "Não foi possível abrir o acesso agora.");
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
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-brand">
          <rect x="4" y="9" width="16" height="11" rx="2" />
          <path d="M12 9V5" /><circle cx="12" cy="3.5" r="1.5" />
          <circle cx="9" cy="14" r="1" /><circle cx="15" cy="14" r="1" />
        </svg>
      </div>
      <h1 className="text-xl font-bold text-neutral-900">
        {onboardingCompleted ? "Seu Agente de IA está pronto" : "Continue a configuração da sua IA"}
      </h1>
      <p className="text-sm text-neutral-500">
        {onboardingCompleted
          ? "Clique abaixo para acessar o painel da sua IA, sem precisar fazer login de novo."
          : "Você começou a configurar seu agente, mas ainda não terminou. Continue de onde parou."}
      </p>
      {error && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700">{error}</p>}
      <button
        onClick={handleAccess}
        disabled={loading}
        className="w-full rounded-xl bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
      >
        {loading ? "Abrindo..." : onboardingCompleted ? "Acessar minha IA" : "Continuar configuração"}
      </button>
    </div>
  );
}

function DemoForm({ api, onSent }: { api: Api; onSent: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [segment, setSegment] = useState("");
  const [revenueRange, setRevenueRange] = useState("");
  const [usage, setUsage] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit() {
    if (!name.trim() || !phone.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const r = await api("/api/public/extension/ai-demo-leads", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          segment: segment.trim() || undefined,
          revenue_range: revenueRange || undefined,
          goal: usage.trim() || undefined,
        }),
      });
      if (!r?.ok) throw new Error(r?.error || "Erro ao enviar");
      onSent();
    } catch (e: any) {
      setErr(e?.message || "Erro ao enviar formulário");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {err && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700">{err}</p>}
      <div className="space-y-1.5">
        <Label>Nome</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="" />
      </div>
      <div className="space-y-1.5">
        <Label>Telefone (com DDD)</Label>
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="" />
      </div>
      <div className="space-y-1.5">
        <Label>Segmento do seu negócio</Label>
        <Input value={segment} onChange={(e) => setSegment(e.target.value)} placeholder="" />
      </div>
      <div className="space-y-1.5">
        <Label>Faixa de faturamento mensal</Label>
        <Select value={revenueRange} onValueChange={setRevenueRange}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            {REVENUE_RANGES.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Descreva como você quer usar a IA/agente</Label>
        <Textarea value={usage} onChange={(e) => setUsage(e.target.value)} rows={4} placeholder="" />
      </div>
      <button
        onClick={handleSubmit}
        disabled={!name.trim() || !phone.trim() || saving}
        className="w-full rounded-xl bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
      >
        {saving ? "Enviando..." : "Enviar"}
      </button>
    </div>
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
      if (!r?.ok || !r.action_link) throw new Error(r?.error || "Não foi possível abrir o acesso agora.");
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
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-brand">
          <rect x="4" y="9" width="16" height="11" rx="2" />
          <path d="M12 9V5" /><circle cx="12" cy="3.5" r="1.5" />
          <circle cx="9" cy="14" r="1" /><circle cx="15" cy="14" r="1" />
        </svg>
      </div>
      <h1 className="text-xl font-bold text-neutral-900">Seu Agente de IA está pronto</h1>
      <p className="text-sm text-neutral-500">Clique abaixo para acessar o painel da sua IA, sem precisar fazer login de novo.</p>
      {error && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700">{error}</p>}
      <button
        onClick={handleAccess}
        disabled={loading}
        className="w-full rounded-xl bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
      >
        {loading ? "Abrindo..." : "Acessar minha IA"}
      </button>
    </div>
  );
}
