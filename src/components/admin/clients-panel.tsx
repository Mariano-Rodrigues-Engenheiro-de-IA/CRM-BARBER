// Painel de Clientes — visão geral (visão do Mariano): nome, contato,
// conexão WhatsApp e se compartilha instância com a IA. Extraído de
// admin.clients.tsx para ser reaproveitado dentro do painel admin
// unificado (com abas).

import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adminListClientsOverview, adminSetBusinessType } from "@/lib/admin-whatsapp.functions";
import { useCachedFetch } from "@/lib/api-cache";

type Row = Awaited<ReturnType<typeof adminListClientsOverview>>[number];

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  barbearia: "Barbearia",
  odontologia: "Odontologia",
};

function statusBadge(status: string | null) {
  if (status === "connected") return "bg-emerald-100 text-emerald-700";
  if (status === "connecting") return "bg-amber-100 text-amber-700";
  return "bg-neutral-100 text-neutral-600";
}

function statusLabel(status: string | null) {
  if (status === "connected") return "Conectado";
  if (status === "connecting") return "Conectando";
  if (status === "disconnected") return "Desconectado";
  return "Sem conexão";
}

export function AdminClientsPanel() {
  const listClients = useServerFn(adminListClientsOverview);
  const setBusinessType = useServerFn(adminSetBusinessType);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const { data: rows, setData: setRows } = useCachedFetch<Row[]>("admin-clients", async () => {
    try {
      return await listClients();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return [];
    }
  });

  async function handleBusinessTypeChange(barbershop_id: string, business_type: "barbearia" | "odontologia") {
    // Otimista: atualiza a tela na hora, sem esperar o servidor — só
    // volta atrás se der erro de verdade.
    const previous = rows;
    setRows((current) => (current ?? []).map((r) => (r.barbershop_id === barbershop_id ? { ...r, business_type } : r)));
    setSavingId(barbershop_id);
    try {
      await setBusinessType({ data: { barbershop_id, business_type } });
    } catch (err) {
      setRows(previous ?? []);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingId(null);
    }
  }

  const filtered = (rows ?? []).filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      r.name.toLowerCase().includes(q) ||
      (r.owner_phone ?? "").includes(q) ||
      (r.owner_email ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Clientes</h1>
        <p className="text-sm text-neutral-500">Visão geral — contato, conexão WhatsApp e uso.</p>
      </div>

      {error && <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

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
              <th className="px-4 py-3 font-medium">Nome</th>
              <th className="px-4 py-3 font-medium">Nicho</th>
              <th className="px-4 py-3 font-medium">Telefone</th>
              <th className="px-4 py-3 font-medium">E-mail</th>
              <th className="px-4 py-3 font-medium">Clientes</th>
              <th className="px-4 py-3 font-medium">Conexão</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Compartilha c/ IA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {!rows ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-neutral-500">
                  Carregando...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-neutral-500">
                  Nenhum cliente encontrado.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.barbershop_id}>
                  <td className="px-4 py-3 font-medium text-neutral-900">{r.name}</td>
                  <td className="px-4 py-3">
                    <select
                      value={r.business_type}
                      disabled={savingId === r.barbershop_id}
                      onChange={(e) =>
                        handleBusinessTypeChange(r.barbershop_id, e.target.value as "barbearia" | "odontologia")
                      }
                      className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-xs outline-none focus:border-brand disabled:opacity-50"
                    >
                      {Object.entries(BUSINESS_TYPE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-neutral-700">{r.owner_phone || "—"}</td>
                  <td className="px-4 py-3 text-neutral-700">{r.owner_email || "—"}</td>
                  <td className="px-4 py-3 text-neutral-700">{r.customers_count}</td>
                  <td className="px-4 py-3 text-neutral-700">
                    {r.provider === "meta" ? "API Oficial" : r.provider === "uazapi" ? "API não oficial" : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusBadge(r.status)}`}>
                      {statusLabel(r.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {r.shared_with_ai ? (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                        Sim (com a IA)
                      </span>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
