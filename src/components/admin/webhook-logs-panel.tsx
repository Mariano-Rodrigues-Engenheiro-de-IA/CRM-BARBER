// Painel de logs do webhook (Meta/WhatsApp) — mostra as últimas 100
// chamadas recebidas, pra confirmar de dentro do próprio CRM se a Meta
// está de fato mandando algo (e o quê) pro endpoint configurado.

import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adminListWebhookLogs } from "@/lib/admin-webhook-logs.functions";
import { Button } from "@/components/ui/button";
import { useCachedFetch } from "@/lib/api-cache";

type Row = Awaited<ReturnType<typeof adminListWebhookLogs>>[number];

function KindBadge({ kind, statusCode }: { kind: string; statusCode: number }) {
  const ok = statusCode >= 200 && statusCode < 300;
  const cls = ok
    ? "bg-emerald-100 text-emerald-700"
    : kind === "verify"
      ? "bg-amber-100 text-amber-700"
      : "bg-red-100 text-red-700";
  const label = kind === "verify" ? "Verificação" : kind === "rejected" ? "Rejeitado" : "Evento";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${cls}`}>{label} · {statusCode}</span>;
}

export function AdminWebhookLogsPanel() {
  const listLogs = useServerFn(adminListWebhookLogs);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: rows, refetch: reload, loading } = useCachedFetch<Row[]>("admin-webhook-logs", async () => {
    try {
      return await listLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return [];
    }
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">Logs do webhook (Meta/WhatsApp)</h2>
          <p className="text-sm text-neutral-500">
            Últimas 100 chamadas recebidas em <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">/api/public/whatsapp/webhook</code>.
            Se a Meta estiver mandando algo, aparece aqui — mesmo que dê erro.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void reload()}>
          {loading ? "Atualizando..." : "Atualizar"}
        </Button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {!rows || rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-400">
          Nenhuma chamada registrada ainda. Se você já tentou verificar o webhook na Meta e não aparece nada aqui, é sinal
          de que a chamada nem está chegando no servidor — provavelmente a URL colada na Meta está errada, ou o deploy com
          essa correção ainda não saiu.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="rounded-lg border border-neutral-200 bg-white">
              <button
                type="button"
                onClick={() => setExpandedId((prev) => (prev === row.id ? null : row.id))}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <KindBadge kind={row.kind} statusCode={row.status_code} />
                  <span className="truncate text-sm text-neutral-700">{row.note || "—"}</span>
                </div>
                <span className="shrink-0 text-xs text-neutral-400">
                  {new Date(row.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              </button>
              {expandedId === row.id && (
                <div className="space-y-2 border-t border-neutral-100 px-4 py-3">
                  <div>
                    <p className="text-xs font-semibold text-neutral-500">Cabeçalhos relevantes</p>
                    <pre className="mt-1 max-h-40 overflow-auto rounded bg-neutral-50 p-2 text-xs text-neutral-700">
                      {JSON.stringify(row.headers, null, 2)}
                    </pre>
                  </div>
                  {row.body != null && (
                    <div>
                      <p className="text-xs font-semibold text-neutral-500">Corpo</p>
                      <pre className="mt-1 max-h-64 overflow-auto rounded bg-neutral-50 p-2 text-xs text-neutral-700">
                        {JSON.stringify(row.body, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
