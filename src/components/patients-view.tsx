// Aba Pacientes/Prontuário — só aparece pra contas com business_type =
// "odontologia". Busca um paciente, vê a ficha completa dele: por
// enquanto o odontograma, depois entram anexos e mais seções.
//
// Layout de duas colunas de propósito: lista estreita à esquerda pra
// buscar/escolher, painel largo à direita pro odontograma respirar —
// foi pedido explícito, o desenho precisa de espaço, não cabe
// espremido num modal pequeno.

import { useState, Suspense, lazy } from "react";
import { createPortal } from "react-dom";
import { DentalBudgetTab } from "@/components/dental-budget-tab";
import { DentalAttachmentsTab } from "@/components/dental-attachments-tab";
import { PatientNotesCard } from "@/components/patient-notes-card";

const DentalChartTab = lazy(() =>
  import("@/components/dental-chart-tab").then((m) => ({ default: m.DentalChartTab })),
);

type ApiFn = (path: string, opts?: RequestInit) => Promise<any>;

type PatientRow = {
  id: string;
  name: string;
  phone: string;
  notes?: string | null;
  archived_at: string | null;
};

export function PatientsView({
  api,
  customers,
  clinicName,
  clinicLogo,
  headerHost,
  onPatientCreated,
}: {
  api: ApiFn;
  customers: PatientRow[];
  clinicName?: string;
  clinicLogo?: string;
  headerHost?: HTMLElement | null;
  onPatientCreated?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(true);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [newFormOpen, setNewFormOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [savingNew, setSavingNew] = useState(false);
  // Guarda o paciente recém-criado localmente até a lista do componente
  // pai (painel.tsx) recarregar de verdade — sem isso, "abrir ficha"
  // logo após cadastrar mostraria "selecione um paciente" por um
  // instante, já que ele ainda não existiria na prop `customers`.
  const [justCreated, setJustCreated] = useState<PatientRow | null>(null);

  const active = customers.filter((c) => !c.archived_at);
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  const filtered = q
    ? active.filter(
        (c) => c.name.toLowerCase().includes(q) || (digits.length > 0 && c.phone.replace(/\D/g, "").includes(digits)),
      )
    : active;

  const selected = active.find((c) => c.id === selectedId) ?? (justCreated?.id === selectedId ? justCreated : null);

  function selectPatient(id: string) {
    setSelectedId(id);
    // Recolhe a lista assim que escolhe alguém — o espaço passa a
    // servir pro odontograma, que precisa respirar. Fica só um resumo
    // com botão pra trocar de paciente sem perder a busca.
    setListOpen(false);
  }

  async function createPatient() {
    if (!newName.trim() || !newPhone.trim()) return;
    setSavingNew(true);
    const res = await api("/api/public/extension/customers", {
      method: "POST",
      body: JSON.stringify({ name: newName.trim(), phone: newPhone.trim() }),
    });
    setSavingNew(false);
    if (res?.ok && res.customer) {
      onPatientCreated?.();
      setJustCreated(res.customer);
      setNewFormOpen(false);
      setNewName("");
      setNewPhone("");
      selectPatient(res.customer.id);
    }
  }

  // Cabeçalho da seção (compartilhado com o resto do painel, mesmo
  // truque de portal que Funis já usa): quando tem paciente selecionado
  // e a lista está fechada, mostra "Trocar paciente" + nome + o ícone
  // de orçamento ali em cima, economizando a linha que tinha dentro do
  // conteúdo — pedido explícito do Mariano, "some uma das abas".
  const header =
    selected && !listOpen ? (
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setListOpen(true)}
          title="Trocar paciente"
          className="flex shrink-0 items-center gap-1.5 rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 6l-6 6 6 6" />
          </svg>
          Trocar paciente
        </button>
        <span className="truncate text-sm font-semibold text-neutral-950">{selected.name}</span>
        <button
          type="button"
          onClick={() => setBudgetOpen(true)}
          title="Histórico e orçamento"
          className="flex shrink-0 items-center justify-center rounded-full p-1.5 text-emerald-600 hover:bg-emerald-50"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v10" />
            <path d="M9.5 9.5c0-1.1 1.1-2 2.5-2s2.5.7 2.5 1.8-1.1 1.6-2.5 1.9c-1.5.3-2.5.8-2.5 1.9S10.9 15 12.3 15s2.5-.7 2.5-1.8" />
          </svg>
        </button>
      </div>
    ) : (
      <h1 className="truncate text-[15px] font-semibold text-neutral-900">Pacientes</h1>
    );

  return (
    <>
      {headerHost ? createPortal(header, headerHost) : null}

      <div className={(listOpen ? "flex gap-4 " : "") + "print:hidden"}>
        {listOpen && (
          <div className="w-72 shrink-0 space-y-3 print:hidden">
            <div className="flex items-center gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar paciente por nome ou telefone"
                className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand"
              />
              <button
                type="button"
                onClick={() => setNewFormOpen((v) => !v)}
                title="Novo paciente"
                className="flex shrink-0 items-center justify-center rounded-xl border border-neutral-300 bg-white p-2 text-neutral-600 hover:bg-neutral-50"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </div>

            {newFormOpen && (
              <div className="space-y-2 rounded-xl border border-neutral-200 bg-white p-3">
                <p className="text-xs font-semibold text-neutral-600">Novo paciente</p>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nome"
                  className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
                />
                <input
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="WhatsApp (com DDD)"
                  className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={createPatient}
                  disabled={savingNew || !newName.trim() || !newPhone.trim()}
                  className="w-full rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
                >
                  {savingNew ? "Salvando..." : "Cadastrar e abrir ficha"}
                </button>
              </div>
            )}

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
        )}

        <div className={listOpen ? "min-w-0 flex-1" : ""}>
          {!selected ? (
            <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-neutral-300 text-sm text-neutral-400">
              Selecione um paciente na lista pra ver a ficha completa.
            </div>
          ) : (
            <div className="space-y-4">
              <PatientNotesCard api={api} customerId={selected.id} initialNotes={selected.notes ?? null} />

              <div className="rounded-xl border border-neutral-200 bg-white p-4 print:hidden">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">Odontograma</h3>
                <Suspense fallback={<p className="text-sm text-neutral-400">Carregando...</p>}>
                  <DentalChartTab api={api} customerId={selected.id} clinicName={clinicName} clinicLogo={clinicLogo} />
                </Suspense>
              </div>

              <div className="rounded-xl border border-neutral-200 bg-white p-4 print:hidden">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">Anexos</h3>
                <DentalAttachmentsTab api={api} customerId={selected.id} />
              </div>
            </div>
          )}
        </div>
      </div>

      {budgetOpen && selected && (
        <BudgetModal title={`Histórico e orçamento de ${selected.name}`} onClose={() => setBudgetOpen(false)}>
          <DentalBudgetTab api={api} customerId={selected.id} />
        </BudgetModal>
      )}
    </>
  );
}

/** Modal largo, de propósito — o orçamento tem duas colunas lado a
 * lado (plano de tratamento + pagamentos), não cabe no modal estreito
 * padrão do resto do sistema. Mesmo visual (fundo claro, cantos
 * arredondados, entrada suave), só mais espaçoso. */
function BudgetModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="print:static print:block fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/20 p-5"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="print:shadow-none print:max-w-none print:w-full my-8 w-full max-w-5xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-neutral-100 px-5 py-4 print:border-none">
          <h3 className="flex-1 truncate text-base font-bold text-neutral-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="print:hidden flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
