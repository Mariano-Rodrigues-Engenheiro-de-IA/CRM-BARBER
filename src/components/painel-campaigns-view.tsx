// Aba "Campanhas" do painel - lista campanhas de disparo em massa com
// status/contadores em tempo real e detalhe expandível dos contatos de
// cada uma. Extraído de painel.tsx pra reduzir o tamanho desse arquivo
// (era um dos 3 arquivos gigantes apontados na varredura de código
// morto/arquitetura).

import { useEffect, useRef, useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { api } from "@/lib/painel-api";

type Campaign = {
  id: string;
  name: string;
  status: string;
  created_at?: string;
  last_error?: string | null;
  stats: { pending: number; sent: number; failed: number };
};

type CampaignJobRow = {
  id: string;
  name: string | null;
  phone: string;
  status: string;
  error: string | null;
};

const campaignsCache: Record<string, Campaign[] | undefined> = {};

export function CampaignsView({ token, scope }: { token: string; scope?: "assinaturas" | "funil" }) {
  const { confirm, dialog } = useConfirm();
  const cacheKey = scope ?? "todos";
  const [campaigns, setCampaigns] = useState<Campaign[]>(campaignsCache[cacheKey] ?? []);
  const [loaded, setLoaded] = useState<boolean>(campaignsCache[cacheKey] !== undefined);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Detalhe expandido (lista de contatos individuais) de UMA campanha por
  // vez — evita fazer polling pesado de todos os jobs de todas as
  // campanhas o tempo todo, só busca quando o usuário realmente abre.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedJobs, setExpandedJobs] = useState<CampaignJobRow[]>([]);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const jobsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadJobs(campaignId: string) {
    const r = await api(token, `/api/public/extension/campaigns/${campaignId}`);
    if (r?.ok) setExpandedJobs(r.jobs || []);
  }

  function toggleExpanded(c: Campaign) {
    if (expandedId === c.id) {
      setExpandedId(null);
      setExpandedJobs([]);
      if (jobsTimerRef.current) clearInterval(jobsTimerRef.current);
      return;
    }
    setExpandedId(c.id);
    setExpandedLoading(true);
    loadJobs(c.id).finally(() => setExpandedLoading(false));
  }

  useEffect(() => {
    if (jobsTimerRef.current) clearInterval(jobsTimerRef.current);
    if (!expandedId) return;
    const campaign = campaigns.find((c) => c.id === expandedId);
    // Só faz polling enquanto a campanha estiver realmente em andamento —
    // campanha parada/cancelada não muda mais, não precisa recarregar.
    if (campaign?.status !== "running") return;
    jobsTimerRef.current = setInterval(() => loadJobs(expandedId), 3000);
    return () => {
      if (jobsTimerRef.current) clearInterval(jobsTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedId, campaigns.find((c) => c.id === expandedId)?.status]);

  async function reload() {
    const r = await api(token, `/api/public/extension/campaigns${scope ? `?scope=${scope}` : ""}`);
    if (r?.ok) {
      const list: Campaign[] = r.campaigns || [];
      campaignsCache[cacheKey] = list;
      setCampaigns(list);
    }
    setLoaded(true);
  }

  useEffect(() => {
    reload();
    timerRef.current = setInterval(reload, 4000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleStatus(c: Campaign) {
    const next = c.status === "running" ? "paused" : "running";
    await api(token, `/api/public/extension/campaigns/${c.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: next }),
    });
    reload();
  }

  async function cancelCamp(c: Campaign) {
    const ok = await confirm({
      title: `Cancelar campanha "${c.name}"?`,
      description: "Os jobs pendentes não serão disparados.",
      confirmLabel: "Cancelar campanha",
      cancelLabel: "Voltar",
      destructive: true,
    });
    if (!ok) return;
    await api(token, `/api/public/extension/campaigns/${c.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "canceled" }),
    });
    reload();
  }

  async function deleteCamp(c: Campaign) {
    const ok = await confirm({
      title: `Apagar a campanha "${c.name}"?`,
      description: "Remove a campanha e todos os jobs dela do histórico. Não dá pra desfazer.",
      confirmLabel: "Apagar",
      destructive: true,
    });
    if (!ok) return;
    await api(token, `/api/public/extension/campaigns/${c.id}`, { method: "DELETE" });
    reload();
  }

  if (!loaded && campaigns.length === 0) return null;

  return (
    <div className="space-y-3">
      {dialog}

      {loaded && campaigns.length === 0 && (
        <p className="text-sm text-neutral-500">Nenhuma campanha criada ainda.</p>
      )}
      {campaigns.map((c) => {
        const total = c.stats.pending + c.stats.sent + c.stats.failed;
        const done = c.stats.sent + c.stats.failed;
        const pct = total ? Math.round((done / total) * 100) : 0;
        const isRunning = c.status === "running";
        const isFinal = c.status === "canceled" || (total > 0 && c.stats.pending === 0);
        return (
          <div key={c.id} className="rounded-xl border border-neutral-300 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-neutral-900">{c.name}</h3>
                <p className="text-xs uppercase tracking-wide text-neutral-500">
                  {isFinal && c.status !== "canceled"
                    ? "Finalizada"
                    : c.status === "running"
                      ? "Em andamento"
                      : c.status === "paused"
                        ? "Pausada"
                        : c.status === "canceled"
                          ? "Cancelada"
                          : c.status}
                </p>
                {c.created_at && (
                  <p className="mt-0.5 text-[11px] text-neutral-400">
                    Criada em{" "}
                    {new Date(c.created_at).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {!isFinal && (
                  <button
                    onClick={() => cancelCamp(c)}
                    className="rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-600 hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                  >
                    Cancelar Envio
                  </button>
                )}
                <button
                  onClick={() => deleteCamp(c)}
                  title="Apagar campanha"
                  className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-400 hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                >
                  🗑
                </button>
              </div>
            </div>

            {/* Contadores grandes — Total / Enviados / Erros, igual à
                referência que o Mariano mandou (extensão "Envio Rápido"). */}
            <div className="mt-5 grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-neutral-500">
                  Total de contatos
                </p>
                <p className="mt-1 text-2xl font-bold text-neutral-900">{total}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-neutral-500">Enviados</p>
                <p className="mt-1 text-2xl font-bold text-emerald-600">{c.stats.sent}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-neutral-500">
                  Erro ao enviar
                </p>
                <p className="mt-1 text-2xl font-bold text-red-600">{c.stats.failed}</p>
              </div>
            </div>

            {!isFinal && (
              <button
                onClick={() => toggleStatus(c)}
                className={
                  "mx-auto mt-4 block rounded-full px-6 py-2 text-sm font-semibold transition " +
                  (isRunning
                    ? "bg-emerald-500 text-white hover:bg-emerald-600"
                    : "bg-brand text-white hover:bg-brand-strong")
                }
              >
                {isRunning ? "⏸ Pausar Campanha" : "▶ Retomar Campanha"}
              </button>
            )}

            <div className="mt-4">
              <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                <div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
                <button
                  onClick={() => toggleExpanded(c)}
                  className="font-medium text-brand hover:underline"
                >
                  {expandedId === c.id ? "Ocultar detalhes" : "Ver detalhes por contato"}
                </button>
                <span>
                  {done} / {total} processados · {pct}%
                </span>
              </div>
            </div>

            {/* Tabela de contatos individuais — só busca/mostra quando o
                usuário expande, pra não pesar com polling desnecessário
                para campanhas que ninguém está olhando no momento. */}
            {expandedId === c.id && (
              <div className="mt-4 overflow-hidden rounded-lg border border-neutral-200">
                {expandedLoading && expandedJobs.length === 0 ? (
                  <p className="p-4 text-center text-sm text-neutral-500">Carregando...</p>
                ) : expandedJobs.length === 0 ? (
                  <p className="p-4 text-center text-sm text-neutral-500">
                    Nenhum contato nessa campanha.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-neutral-50 text-left text-[11px] uppercase tracking-wide text-neutral-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">Nome</th>
                        <th className="px-3 py-2 font-medium">Número</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {expandedJobs.map((j) => (
                        <tr key={j.id}>
                          <td className="px-3 py-2 text-neutral-800">{j.name || "—"}</td>
                          <td className="px-3 py-2 text-neutral-600">{j.phone}</td>
                          <td className="px-3 py-2">
                            <span
                              className={
                                "rounded-full px-2 py-0.5 text-[11px] font-semibold " +
                                (j.status === "sent"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : j.status === "failed"
                                    ? "bg-red-100 text-red-700"
                                    : "bg-neutral-100 text-neutral-600")
                              }
                              title={j.error || undefined}
                            >
                              {j.status === "sent"
                                ? "Enviado"
                                : j.status === "failed"
                                  ? "Falhou"
                                  : j.status === "in_flight"
                                    ? "Enviando"
                                    : "Pendente"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
