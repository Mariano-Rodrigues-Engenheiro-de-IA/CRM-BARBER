import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { youtubeEmbedUrl } from "@/lib/youtube";

type Api = (path: string, opts?: RequestInit) => Promise<any>;

const REVENUE_RANGES = [
  "Até R$ 5.000/mês",
  "R$ 5.001 a R$ 15.000/mês",
  "R$ 15.001 a R$ 30.000/mês",
  "R$ 30.001 a R$ 60.000/mês",
  "Acima de R$ 60.000/mês",
];

/** Página do Agente de IA — vitrine + agendar demonstração (não é mais
 * checkout direto: a venda acontece por contato humano, depois de
 * preencher esse formulário). Se o admin já vinculou a conta (depois da
 * compra), mostra direto o botão de acesso, sem passar pela vitrine. */
export function AgenteIaView({ api }: { api: Api }) {
  const [formOpen, setFormOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [salesVideoUrl, setSalesVideoUrl] = useState<string | null>(null);
  const [accessEnabled, setAccessEnabled] = useState<boolean | null>(null);
  const [loadingAccess, setLoadingAccess] = useState(true);
  const [bannerLoaded, setBannerLoaded] = useState(false);

  useEffect(() => {
    api("/api/public/extension/agente-ia-settings").then((r) => {
      if (r?.ok) setSalesVideoUrl(r.sales_video_url);
    });
    api("/api/public/extension/billing")
      .then((r) => {
        if (r?.ok) setAccessEnabled(Boolean(r.billing?.ai_access_enabled));
      })
      .finally(() => setLoadingAccess(false));
    // Pré-carrega a imagem do banner antes de mostrar o texto por cima —
    // evita o nome/frase aparecendo antes da imagem (impressão de bug).
    const img = new Image();
    img.src = "/academy/agente-ia-banner.jpg";
    img.onload = () => setBannerLoaded(true);
    img.onerror = () => setBannerLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Espera saber de verdade se o acesso já foi liberado antes de decidir
  // qual tela mostrar — sem isso, a vitrine (com banner) aparecia por um
  // instante mesmo pra quem já tem acesso, e depois trocava de tela.
  if (loadingAccess) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-300 border-t-brand" />
      </div>
    );
  }

  if (accessEnabled) {
    return <AiAccessGranted api={api} />;
  }

  const embedUrl = salesVideoUrl ? youtubeEmbedUrl(salesVideoUrl) : null;

  if (sent) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-white">Ótimo!</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Um de nossos especialistas vai entrar em contato com você pra agendar uma demonstração.
        </p>
      </div>
    );
  }

  return (
    <div className="-mx-4 -my-6 min-h-[calc(100vh-56px)] bg-neutral-950 px-4 py-8 sm:-mx-6" style={{ backgroundImage: "radial-gradient(rgba(90,140,255,0.14) 1px, transparent 1px)", backgroundSize: "26px 26px" }}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div
          className="h-[3px] w-full rounded-full"
          style={{
            background: "linear-gradient(90deg, #3b82f6, #22d3ee, #3b82f6)",
            backgroundSize: "200% 100%",
            animation: "ai-glow-move 6s linear infinite",
          }}
        />
        <style>{`@keyframes ai-glow-move { 0% { background-position: 0% 0%; } 100% { background-position: 200% 0%; } }`}</style>

        {/* Botão em destaque logo no topo — economiza espaço, sempre visível */}
        <div className="text-center">
          <button
            onClick={() => setFormOpen((v) => !v)}
            className="rounded-xl bg-brand px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-brand/20 hover:bg-brand-strong"
          >
            {formOpen ? "Fechar formulário" : "Agendar demonstração"}
          </button>
        </div>

        {formOpen && <DemoForm api={api} onSent={() => setSent(true)} />}

        <div
          className="relative min-h-[130px] overflow-hidden rounded-2xl transition-opacity duration-300"
          style={{
            opacity: bannerLoaded ? 1 : 0,
            backgroundImage: bannerLoaded
              ? "url(/academy/agente-ia-banner.jpg), radial-gradient(circle at 20% 30%, #1c2440 0%, #0a0e1e 55%, #05070f 100%)"
              : undefined,
            backgroundSize: "cover, cover",
            backgroundPosition: "center, center",
          }}
        >
          <div className="flex min-h-[130px] flex-col justify-center px-6 py-5 md:px-10">
            <span className="mb-2 inline-block w-fit rounded-full bg-brand px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
              Novidade
            </span>
            <h1 className="max-w-md text-xl font-bold text-white md:text-2xl">Agente de IA para o seu WhatsApp</h1>
            <p className="mt-1 max-w-sm text-xs text-neutral-200 md:text-sm">
              Atendimento e agendamento automático, 24h por dia, direto no WhatsApp do seu negócio.
            </p>
          </div>
        </div>

        {embedUrl ? (
          <div className="mx-auto aspect-video w-full max-w-md overflow-hidden rounded-2xl">
            <iframe
              src={embedUrl}
              title="Conheça o Agente de IA"
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          <div className="mx-auto max-w-md rounded-2xl border border-dashed border-neutral-700 bg-neutral-900 p-6 text-center">
            <p className="text-sm text-neutral-500">Vídeo de apresentação em breve.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function DemoForm({ api, onSent }: { api: Api; onSent: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [segment, setSegment] = useState("");
  const [revenueRange, setRevenueRange] = useState("");
  const [goal, setGoal] = useState<"vendas" | "agendamento" | "ambos" | "">("");
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
          goal: goal || undefined,
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
    <div className="mx-auto max-w-lg space-y-4 rounded-2xl border border-neutral-200 bg-white p-6">
      <h2 className="text-lg font-bold text-neutral-900">Agendar demonstração</h2>
      {err && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700">{err}</p>}
      <div className="space-y-1.5">
        <Label>Nome</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>Telefone (com DDD)</Label>
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ex: 44991234567" />
      </div>
      <div className="space-y-1.5">
        <Label>Segmento do seu negócio</Label>
        <Input value={segment} onChange={(e) => setSegment(e.target.value)} placeholder="Ex: Barbearia, Salão, Clínica de estética..." />
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
        <Label>O que você mais precisa da IA?</Label>
        <Select value={goal} onValueChange={(v) => setGoal(v as any)}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="vendas">Mais vendas</SelectItem>
            <SelectItem value="agendamento">Agendamento automático</SelectItem>
            <SelectItem value="ambos">Os dois</SelectItem>
          </SelectContent>
        </Select>
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
