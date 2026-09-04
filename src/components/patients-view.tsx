// Aba Pacientes/Prontuário — só aparece pra contas com business_type =
// "odontologia". Busca um paciente, vê a ficha completa dele: por
// enquanto o odontograma, depois entram anexos e mais seções.
//
// Layout de duas colunas de propósito: lista estreita à esquerda pra
// buscar/escolher, painel largo à direita pro odontograma respirar —
// foi pedido explícito, o desenho precisa de espaço, não cabe
// espremido num modal pequeno.

import { useState, Suspense, lazy } from "react";
import { DentalBudgetTab } from "@/components/dental-budget-tab";

const DentalChartTab = lazy(() =>
  import("@/components/dental-chart-tab").then((m) => ({ default: m.DentalChartTab })),
);

type ApiFn = (path: string, opts?: RequestInit) => Promise<any>;

type PatientRow = {
  id: string;
  name: string;
  phone: string;
  archived_at: string | null;
};

export function PatientsView({ api, customers }: { api: ApiFn; customers: PatientRow[] }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(true);

  const active = customers.filter((c) => !c.archived_at);
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  const filtered = q
    ? active.filter(
        (c) => c.name.toLowerCase().includes(q) || (digits.length > 0 && c.phone.replace(/\D/g, "").includes(digits)),
      )
    : active;

  const selected = active.find((c) => c.id === selectedId) ?? null;

  function selectPatient(id: string) {
    setSelectedId(id);
    // Recolhe a lista assim que escolhe alguém — o espaço passa a
    // servir pro odontograma, que precisa respirar. Fica só um resumo
    // com botão pra trocar de paciente sem perder a busca.
    setListOpen(false);
  }

  return (
    <div className="flex gap-4 print:block">
      {listOpen ? (
        <div className="w-72 shrink-0 space-y-3 print:hidden">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar paciente por nome ou telefone"
            className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <div className="max-h-[70vh] space-y-1 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-1.5">
            {filtered.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-neutral-400">Nenhum paciente encontrado.</p>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => selectPatient(c.id)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                    selectedId === c.id ? "bg-brand/10 font-semibold text-brand" : "text-neutral-700 hover:bg-neutral-50"
                  }`}
                >
                  <p className="truncate">{c.name}</p>
                  <p className="truncate text-xs text-neutral-400">{c.phone}</p>
                </button>
              ))
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setListOpen(true)}
          title="Trocar paciente"
          className="print:hidden flex h-fit shrink-0 items-center gap-1.5 rounded-xl border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 6l-6 6 6 6" />
          </svg>
          Trocar paciente
        </button>
      )}

      <div className="min-w-0 flex-1">
        {!selected ? (
          <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-neutral-300 text-sm text-neutral-400">
            Selecione um paciente na lista pra ver a ficha completa.
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-neutral-950">{selected.name}</h2>
              <p className="text-sm text-neutral-500">{selected.phone}</p>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-4 print:hidden">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">Odontograma</h3>
              <Suspense fallback={<p className="text-sm text-neutral-400">Carregando...</p>}>
                <DentalChartTab api={api} customerId={selected.id} />
              </Suspense>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500 print:text-black">
                Histórico e orçamento de {selected.name}
              </h3>
              <DentalBudgetTab api={api} customerId={selected.id} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
