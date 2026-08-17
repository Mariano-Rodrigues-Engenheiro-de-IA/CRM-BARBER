import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { youtubeEmbedUrl } from "@/lib/youtube";

type Api = (path: string, opts?: RequestInit) => Promise<any>;

// Vídeo de vendas explicando o Agente de IA — troca esse link quando o
// Mariano gravar o vídeo definitivo (mesmo padrão simples do banner).
const SALES_VIDEO_URL: string | null = null;

const REVENUE_RANGES = [
  "Até R$ 5.000/mês",
  "R$ 5.001 a R$ 15.000/mês",
  "R$ 15.001 a R$ 30.000/mês",
  "R$ 30.001 a R$ 60.000/mês",
  "Acima de R$ 60.000/mês",
];

/** Página do Agente de IA — vitrine + agendar demonstração (não é mais
 * checkout direto: a venda acontece por contato humano, depois de
 * preencher esse formulário). */
export function AgenteIaView({ api }: { api: Api }) {
  const [formOpen, setFormOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const embedUrl = SALES_VIDEO_URL ? youtubeEmbedUrl(SALES_VIDEO_URL) : null;

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

      {!formOpen ? (
        <div className="text-center">
          <button
            onClick={() => setFormOpen(true)}
            className="rounded-xl bg-brand px-8 py-3 text-sm font-semibold text-white hover:bg-brand-strong"
          >
            Agendar demonstração
          </button>
        </div>
      ) : (
        <DemoForm api={api} onSent={() => setSent(true)} />
      )}
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
