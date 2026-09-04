// Histórico de visitas + orçamento do paciente — dentro da aba
// Pacientes. Visitas vêm da Agenda (sem duplicar nada); cada visita
// pode ter um ou mais procedimentos lançados (dente, tipo, valor,
// pago/pendente). O resumo geral soma tudo isso.

import { useEffect, useState } from "react";

type ApiFn = (path: string, opts?: RequestInit) => Promise<any>;

type Appointment = {
  id: string;
  title: string;
  scheduled_at: string;
  status: string;
};

type Procedure = {
  id: string;
  appointment_id: string | null;
  tooth_numbers: number[];
  procedure_type: string;
  price_cents: number;
  paid: boolean;
  notes: string | null;
  performed_at: string;
};

const PROCEDURE_TYPES = [
  "Avaliação / Consulta",
  "Restauração",
  "Extração",
  "Tratamento de canal",
  "Implante",
  "Limpeza (profilaxia)",
  "Clareamento",
  "Aparelho ortodôntico",
  "Prótese / Coroa",
  "Aplicação de flúor / selante",
  "Cirurgia",
  "Outro",
];

function centsToBRL(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function brlToCents(text: string): number {
  const digitsOnly = text.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(digitsOnly);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function parseTeeth(text: string): number[] {
  return text
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => Number(t))
    .filter((n) => Number.isInteger(n) && n >= 11 && n <= 85);
}

export function DentalBudgetTab({ api, customerId }: { api: ApiFn; customerId: string }) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formAppointmentId, setFormAppointmentId] = useState<string>("none");
  const [formTooth, setFormTooth] = useState("");
  const [formType, setFormType] = useState(PROCEDURE_TYPES[0]);
  const [formPrice, setFormPrice] = useState("");
  const [formPaid, setFormPaid] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setErr(null);
    const [apptRes, procRes] = await Promise.all([
      api(`/api/public/extension/appointments?customer_id=${encodeURIComponent(customerId)}`),
      api(`/api/public/extension/dental-procedures?customer_id=${encodeURIComponent(customerId)}`),
    ]);
    if (apptRes?.ok) setAppointments(apptRes.appointments || []);
    if (procRes?.ok) setProcedures(procRes.procedures || []);
    if (!apptRes?.ok || !procRes?.ok) setErr("Não consegui carregar o histórico agora.");
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  async function togglePaid(proc: Procedure) {
    const res = await api(`/api/public/extension/dental-procedures/${proc.id}`, {
      method: "PATCH",
      body: JSON.stringify({ paid: !proc.paid }),
    });
    if (res?.ok) setProcedures((prev) => prev.map((p) => (p.id === proc.id ? { ...p, paid: !p.paid } : p)));
  }

  async function removeProcedure(id: string) {
    const res = await api(`/api/public/extension/dental-procedures/${id}`, { method: "DELETE" });
    if (res?.ok) setProcedures((prev) => prev.filter((p) => p.id !== id));
  }

  async function submitForm() {
    if (!formType.trim()) return;
    setSaving(true);
    const res = await api("/api/public/extension/dental-procedures", {
      method: "POST",
      body: JSON.stringify({
        customer_id: customerId,
        appointment_id: formAppointmentId === "none" ? null : formAppointmentId,
        tooth_numbers: parseTeeth(formTooth),
        procedure_type: formType,
        price_cents: brlToCents(formPrice),
        paid: formPaid,
      }),
    });
    setSaving(false);
    if (res?.ok) {
      setProcedures((prev) => [res.procedure, ...prev]);
      setFormOpen(false);
      setFormTooth("");
      setFormPrice("");
      setFormPaid(false);
      setFormAppointmentId("none");
    }
  }

  const totalPaid = procedures.filter((p) => p.paid).reduce((sum, p) => sum + p.price_cents, 0);
  const totalPending = procedures.filter((p) => !p.paid).reduce((sum, p) => sum + p.price_cents, 0);

  // Agrupa por visita (appointment) — procedimentos sem agendamento
  // vinculado caem num grupo "avulso" no fim.
  const byAppointment = new Map<string, Procedure[]>();
  const loose: Procedure[] = [];
  for (const p of procedures) {
    if (p.appointment_id) {
      const list = byAppointment.get(p.appointment_id) ?? [];
      list.push(p);
      byAppointment.set(p.appointment_id, list);
    } else {
      loose.push(p);
    }
  }
  const visitGroups = appointments
    .filter((a) => byAppointment.has(a.id))
    .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime())
    .map((a) => ({ appointment: a, items: byAppointment.get(a.id) ?? [] }));

  if (loading) return <p className="text-sm text-neutral-400">Carregando histórico...</p>;

  return (
    <div className="space-y-4 print:space-y-2">
      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 print:hidden">{err}</div>}

      <div className="grid grid-cols-2 gap-3 print:grid-cols-2">
        <div className="rounded-xl bg-emerald-50 p-3">
          <p className="text-xs font-medium text-emerald-700">Total pago</p>
          <p className="text-lg font-semibold text-emerald-800">{centsToBRL(totalPaid)}</p>
        </div>
        <div className="rounded-xl bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-700">Pendente</p>
          <p className="text-lg font-semibold text-amber-800">{centsToBRL(totalPending)}</p>
        </div>
      </div>

      <div className="flex items-center justify-between print:hidden">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Histórico de visitas</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            Imprimir / exportar
          </button>
          <button
            type="button"
            onClick={() => setFormOpen((v) => !v)}
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-strong"
          >
            {formOpen ? "Cancelar" : "Lançar procedimento"}
          </button>
        </div>
      </div>

      {formOpen && (
        <div className="space-y-2 rounded-xl border border-neutral-200 bg-white p-3 print:hidden">
          <div className="grid grid-cols-2 gap-2">
            <select
              value={formAppointmentId}
              onChange={(e) => setFormAppointmentId(e.target.value)}
              className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
            >
              <option value="none">Sem visita vinculada</option>
              {appointments.map((a) => (
                <option key={a.id} value={a.id}>
                  {new Date(a.scheduled_at).toLocaleDateString("pt-BR")}: {a.title}
                </option>
              ))}
            </select>
            <input
              value={formTooth}
              onChange={(e) => setFormTooth(e.target.value.replace(/[^\d,\s]/g, ""))}
              placeholder="Dentes (opcional, ex: 16, 17, 18)"
              className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
            />
          </div>
          <select
            value={formType}
            onChange={(e) => setFormType(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
          >
            {PROCEDURE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <input
              value={formPrice}
              onChange={(e) => setFormPrice(e.target.value)}
              placeholder="Valor (R$)"
              inputMode="decimal"
              className="flex-1 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
            />
            <label className="flex items-center gap-1.5 text-xs text-neutral-600">
              <input type="checkbox" checked={formPaid} onChange={(e) => setFormPaid(e.target.checked)} />
              Já pago
            </label>
          </div>
          <button
            type="button"
            onClick={submitForm}
            disabled={saving}
            className="w-full rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Salvar procedimento"}
          </button>
        </div>
      )}

      {procedures.length === 0 ? (
        <p className="text-sm text-neutral-400">Nenhum procedimento lançado ainda.</p>
      ) : (
        <div className="space-y-3">
          {visitGroups.map(({ appointment, items }) => (
            <div key={appointment.id} className="rounded-xl border border-neutral-200 bg-white p-3">
              <p className="mb-2 text-sm font-semibold text-neutral-900">
                {new Date(appointment.scheduled_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
              </p>
              <ProcedureList items={items} onTogglePaid={togglePaid} onRemove={removeProcedure} />
            </div>
          ))}
          {loose.length > 0 && (
            <div className="rounded-xl border border-neutral-200 bg-white p-3">
              <p className="mb-2 text-sm font-semibold text-neutral-900">Sem visita vinculada</p>
              <ProcedureList items={loose} onTogglePaid={togglePaid} onRemove={removeProcedure} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProcedureList({
  items,
  onTogglePaid,
  onRemove,
}: {
  items: Procedure[];
  onTogglePaid: (p: Procedure) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      {items.map((p) => (
        <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
          <div className="min-w-0">
            <p className="truncate text-neutral-800">
              {p.procedure_type}
              {p.tooth_numbers.length > 0 ? ` (dente${p.tooth_numbers.length > 1 ? "s" : ""} ${p.tooth_numbers.join(", ")})` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-neutral-600">{centsToBRL(p.price_cents)}</span>
            <button
              type="button"
              onClick={() => onTogglePaid(p)}
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                p.paid ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
              }`}
            >
              {p.paid ? "Pago" : "Pendente"}
            </button>
            <button
              type="button"
              onClick={() => onRemove(p.id)}
              title="Remover"
              className="text-neutral-400 hover:text-red-600 print:hidden"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
