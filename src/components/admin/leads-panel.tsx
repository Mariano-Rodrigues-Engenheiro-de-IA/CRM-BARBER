// Painel de Clientes Interessados — leads do formulário "Agendar
// demonstração" da página Agente de IA. Novo, criado direto pro painel
// admin unificado (não tinha rota antiga).

import { useState } from "react";
import { useCachedFetch } from "@/lib/api-cache";

type Lead = {
  id: string;
  barbershop_id: string | null;
  name: string;
  phone: string;
  segment: string | null;
  revenue_range: string | null;
  goal: string | null;
  status: string;
  created_at: string;
  barbershop_name?: string | null;
};

const STATUS_OPTIONS = [
  { value: "novo", label: "Novo", cls: "bg-blue-100 text-blue-700" },
  { value: "contatado", label: "Contatado", cls: "bg-amber-100 text-amber-700" },
  { value: "convertido", label: "Convertido", cls: "bg-emerald-100 text-emerald-700" },
  { value: "descartado", label: "Descartado", cls: "bg-neutral-100 text-neutral-500" },
];

function statusInfo(status: string) {
  return STATUS_OPTIONS.find((s) => s.value === status) ?? STATUS_OPTIONS[0];
}

function goalLabel(goal: string | null) {
  if (goal === "vendas") return "Mais vendas";
  if (goal === "agendamento") return "Agendamento automático";
  if (goal === "ambos") return "Os dois";
  return "—";
}

export function AdminLeadsPanel({
  listLeads,
  updateLeadStatus,
}: {
  listLeads: () => Promise<Lead[]>;
  updateLeadStatus: (id: string, status: string) => Promise<void>;
}) {
  const { data: leads, setData: setLeads } = useCachedFetch<Lead[]>("admin-leads", async () => {
    try {
      return await listLeads();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return [];
    }
  });
  const [error, setError] = useState<string | null>(null);

  async function handleStatusChange(id: string, status: string) {
    setLeads((prev) => prev?.map((l) => (l.id === id ? { ...l, status } : l)) ?? null);
    await updateLeadStatus(id, status);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Clientes interessados</h1>
        <p className="text-sm text-neutral-500">Quem pediu demonstração do Agente de IA pela página de vendas.</p>
      </div>

      {error && <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {!leads ? (
        <p className="text-sm text-neutral-500">Carregando...</p>
      ) : leads.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-400">
          Ninguém pediu demonstração ainda.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-300 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-[11px] uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Telefone</th>
                <th className="px-4 py-3 font-medium">Barbearia</th>
                <th className="px-4 py-3 font-medium">Segmento</th>
                <th className="px-4 py-3 font-medium">Faturamento</th>
                <th className="px-4 py-3 font-medium">Objetivo</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {leads.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-3 font-medium text-neutral-900">{l.name}</td>
                  <td className="px-4 py-3 text-neutral-700">{l.phone}</td>
                  <td className="px-4 py-3 text-neutral-700">{l.barbershop_name || "—"}</td>
                  <td className="px-4 py-3 text-neutral-700">{l.segment || "—"}</td>
                  <td className="px-4 py-3 text-neutral-700">{l.revenue_range || "—"}</td>
                  <td className="px-4 py-3 text-neutral-700">{goalLabel(l.goal)}</td>
                  <td className="px-4 py-3">
                    <select
                      value={l.status}
                      onChange={(e) => handleStatusChange(l.id, e.target.value)}
                      className={`rounded-full border-0 px-2 py-0.5 text-[11px] font-semibold ${statusInfo(l.status).cls}`}
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
