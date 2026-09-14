// Painel de Assinaturas — lista quem já pagou o CRM (qualquer um dos
// planos) e disponibiliza os links de venda direta (197 e 297) prontos
// pra copiar e mandar pro cliente. Pagamento feito por qualquer um
// desses 2 links libera acesso Premium automaticamente (mesmo
// mecanismo do plano de R$97 — ver billing.server.ts).

import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adminListSubscriptions } from "@/lib/admin-billing.functions";
import { useCachedFetch } from "@/lib/api-cache";

type Row = Awaited<ReturnType<typeof adminListSubscriptions>>[number];

function statusBadge(status: string) {
  if (status === "active" || status === "trialing") return "bg-emerald-100 text-emerald-700";
  if (status === "past_due") return "bg-amber-100 text-amber-700";
  if (status === "canceled") return "bg-neutral-100 text-neutral-600";
  return "bg-neutral-100 text-neutral-600";
}

function statusLabel(status: string) {
  if (status === "active") return "Ativa";
  if (status === "trialing") return "Em teste";
  if (status === "past_due") return "Pagamento atrasado";
  if (status === "canceled") return "Cancelada";
  return status;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

function CopyLinkRow({ label, plano }: { label: string; plano: string }) {
  const [copied, setCopied] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const link = `${origin}/assinar?plano=${plano}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard pode falhar em contexto não-seguro (http) — sem drama,
      // o link já está visível pra selecionar manualmente.
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
      <div>
        <p className="text-sm font-semibold text-neutral-900">{label}</p>
        <p className="mt-0.5 break-all text-xs text-neutral-500">{link}</p>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
      >
        {copied ? "Copiado!" : "Copiar link"}
      </button>
    </div>
  );
}

export function AdminSubscriptionsPanel() {
  const listSubscriptions = useServerFn(adminListSubscriptions);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { data: rows } = useCachedFetch<Row[]>("admin-subscriptions", async () => {
    try {
      return await listSubscriptions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return [];
    }
  });

  const filtered = (rows ?? []).filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      r.shop_name.toLowerCase().includes(q) ||
      (r.owner_phone ?? "").includes(q) ||
      (r.owner_email ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Assinaturas</h1>
        <p className="text-sm text-neutral-500">Assinantes do CRM e links de venda direta.</p>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Links de venda direta — pagamento libera Premium automaticamente
        </p>
        <CopyLinkRow label="Plano R$ 197/mês" plano="premium_197" />
        <CopyLinkRow label="Plano R$ 297/mês" plano="premium_297" />
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar por nome, telefone ou e-mail..."
        className="w-full max-w-md rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm outline-none focus:border-brand"
      />

      <div className="overflow-x-auto rounded-xl border border-neutral-300 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-[11px] uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-medium">Barbearia</th>
              <th className="px-4 py-3 font-medium">Telefone</th>
              <th className="px-4 py-3 font-medium">E-mail</th>
              <th className="px-4 py-3 font-medium">Plano</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Renova/expira em</th>
              <th className="px-4 py-3 font-medium">Assinante desde</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {!rows ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-neutral-500">
                  Carregando...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-neutral-500">
                  Nenhuma assinatura encontrada.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={`${r.barbershop_id}-${r.price_id}`}>
                  <td className="px-4 py-3 font-medium text-neutral-900">{r.shop_name}</td>
                  <td className="px-4 py-3 text-neutral-700">{r.owner_phone || "—"}</td>
                  <td className="px-4 py-3 text-neutral-700">{r.owner_email || "—"}</td>
                  <td className="px-4 py-3 text-neutral-700">{r.plan_label}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusBadge(r.status)}`}
                    >
                      {statusLabel(r.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-700">{formatDate(r.current_period_end)}</td>
                  <td className="px-4 py-3 text-neutral-700">{formatDate(r.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
