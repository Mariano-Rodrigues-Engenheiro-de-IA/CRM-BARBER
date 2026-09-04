// Orçamento do paciente — plano de tratamento e pagamentos lado a lado,
// aproveitando o espaço largo da tela. Marcar "feito" é um botão de
// verdade, clicável direto na lista, sem precisar abrir nada. O saldo
// a pagar conta só o que já foi feito — o paciente não paga o que
// ainda nem aconteceu.

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
  done: boolean;
  notes: string | null;
  performed_at: string;
};

type Payment = {
  id: string;
  amount_cents: number;
  notes: string | null;
  paid_at: string;
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

function IconTrash() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function IconPencil() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="M15 5l4 4" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function IconCircle() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function DentalBudgetTab({ api, customerId }: { api: ApiFn; customerId: string }) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [procFormOpen, setProcFormOpen] = useState(false);
  const [editingProcId, setEditingProcId] = useState<string | null>(null);
  const [procAppointmentId, setProcAppointmentId] = useState<string>("none");
  const [procTooth, setProcTooth] = useState("");
  const [procType, setProcType] = useState(PROCEDURE_TYPES[0]);
  const [procPrice, setProcPrice] = useState("");
  const [procDone, setProcDone] = useState(false);
  const [savingProc, setSavingProc] = useState(false);

  const [payFormOpen, setPayFormOpen] = useState(false);
  const [editingPayId, setEditingPayId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [savingPay, setSavingPay] = useState(false);

  async function load() {
    setLoading(true);
    setErr(null);
    const [apptRes, procRes, payRes] = await Promise.all([
      api(`/api/public/extension/appointments?customer_id=${encodeURIComponent(customerId)}`),
      api(`/api/public/extension/dental-procedures?customer_id=${encodeURIComponent(customerId)}`),
      api(`/api/public/extension/dental-payments?customer_id=${encodeURIComponent(customerId)}`),
    ]);
    if (apptRes?.ok) setAppointments(apptRes.appointments || []);
    if (procRes?.ok) setProcedures(procRes.procedures || []);
    if (payRes?.ok) setPayments(payRes.payments || []);
    if (!apptRes?.ok || !procRes?.ok || !payRes?.ok) setErr("Não consegui carregar o orçamento agora.");
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  function resetProcForm() {
    setProcFormOpen(false);
    setEditingProcId(null);
    setProcAppointmentId("none");
    setProcTooth("");
    setProcType(PROCEDURE_TYPES[0]);
    setProcPrice("");
    setProcDone(false);
  }

  function openEditProc(p: Procedure) {
    setEditingProcId(p.id);
    setProcAppointmentId(p.appointment_id ?? "none");
    setProcTooth(p.tooth_numbers.join(", "));
    setProcType(p.procedure_type);
    setProcPrice((p.price_cents / 100).toFixed(2).replace(".", ","));
    setProcDone(p.done);
    setProcFormOpen(true);
  }

  async function submitProc() {
    setSavingProc(true);
    const body = {
      appointment_id: procAppointmentId === "none" ? null : procAppointmentId,
      tooth_numbers: parseTeeth(procTooth),
      procedure_type: procType,
      price_cents: brlToCents(procPrice),
      done: procDone,
    };
    const res = editingProcId
      ? await api(`/api/public/extension/dental-procedures/${editingProcId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        })
      : await api("/api/public/extension/dental-procedures", {
          method: "POST",
          body: JSON.stringify({ ...body, customer_id: customerId }),
        });
    setSavingProc(false);
    if (res?.ok) {
      const saved = res.procedure as Procedure;
      setProcedures((prev) => (editingProcId ? prev.map((p) => (p.id === saved.id ? saved : p)) : [saved, ...prev]));
      resetProcForm();
    }
  }

  async function toggleDone(proc: Procedure) {
    // Otimista — a tela muda na hora, sem esperar o servidor. É o botão
    // mais usado dessa tela inteira, tem que responder na hora.
    setProcedures((prev) => prev.map((p) => (p.id === proc.id ? { ...p, done: !p.done } : p)));
    const res = await api(`/api/public/extension/dental-procedures/${proc.id}`, {
      method: "PATCH",
      body: JSON.stringify({ done: !proc.done }),
    });
    if (!res?.ok) {
      setProcedures((prev) => prev.map((p) => (p.id === proc.id ? { ...p, done: proc.done } : p)));
    }
  }

  async function removeProcedure(id: string) {
    const res = await api(`/api/public/extension/dental-procedures/${id}`, { method: "DELETE" });
    if (res?.ok) setProcedures((prev) => prev.filter((p) => p.id !== id));
  }

  function resetPayForm() {
    setPayFormOpen(false);
    setEditingPayId(null);
    setPayAmount("");
    setPayNotes("");
  }

  function openEditPay(p: Payment) {
    setEditingPayId(p.id);
    setPayAmount((p.amount_cents / 100).toFixed(2).replace(".", ","));
    setPayNotes(p.notes ?? "");
    setPayFormOpen(true);
  }

  async function submitPay() {
    const amount_cents = brlToCents(payAmount);
    if (amount_cents <= 0) return;
    setSavingPay(true);
    const body = { amount_cents, notes: payNotes.trim() || null };
    const res = editingPayId
      ? await api(`/api/public/extension/dental-payments/${editingPayId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        })
      : await api("/api/public/extension/dental-payments", {
          method: "POST",
          body: JSON.stringify({ ...body, customer_id: customerId }),
        });
    setSavingPay(false);
    if (res?.ok) {
      const saved = res.payment as Payment;
      setPayments((prev) => (editingPayId ? prev.map((p) => (p.id === saved.id ? saved : p)) : [...prev, saved]));
      resetPayForm();
    }
  }

  async function removePayment(id: string) {
    const res = await api(`/api/public/extension/dental-payments/${id}`, { method: "DELETE" });
    if (res?.ok) setPayments((prev) => prev.filter((p) => p.id !== id));
  }

  const totalPlano = procedures.reduce((sum, p) => sum + p.price_cents, 0);
  const totalFeito = procedures.filter((p) => p.done).reduce((sum, p) => sum + p.price_cents, 0);
  const totalPago = payments.reduce((sum, p) => sum + p.amount_cents, 0);
  // Saldo a pagar conta só o que já foi feito — o paciente não deve
  // por procedimento que ainda nem aconteceu, pedido explícito.
  const saldo = totalFeito - totalPago;
  const pendentesCount = procedures.filter((p) => !p.done).length;

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

  if (loading) return <p className="text-sm text-neutral-400">Carregando orçamento...</p>;

  return (
    <div className="space-y-5 print:space-y-2">
      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 print:hidden">{err}</div>}

      <div className="flex items-center justify-between print:hidden">
        <div className="grid flex-1 grid-cols-4 gap-3">
          <div className="rounded-xl bg-neutral-100 p-3">
            <p className="text-xs font-medium text-neutral-600">Plano total</p>
            <p className="text-lg font-semibold text-neutral-900">{centsToBRL(totalPlano)}</p>
          </div>
          <div className="rounded-xl bg-sky-50 p-3">
            <p className="text-xs font-medium text-sky-700">Já feito</p>
            <p className="text-lg font-semibold text-sky-800">{centsToBRL(totalFeito)}</p>
          </div>
          <div className="rounded-xl bg-emerald-50 p-3">
            <p className="text-xs font-medium text-emerald-700">Total pago</p>
            <p className="text-lg font-semibold text-emerald-800">{centsToBRL(totalPago)}</p>
          </div>
          <div className={`rounded-xl p-3 ${saldo > 0 ? "bg-amber-50" : "bg-blue-50"}`}>
            <p className={`text-xs font-medium ${saldo > 0 ? "text-amber-700" : "text-blue-700"}`}>
              {saldo > 0 ? "Falta pagar" : "Crédito"}
            </p>
            <p className={`text-lg font-semibold ${saldo > 0 ? "text-amber-800" : "text-blue-800"}`}>
              {centsToBRL(Math.abs(saldo))}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="ml-3 shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
        >
          Imprimir
        </button>
      </div>
      {pendentesCount > 0 && (
        <p className="-mt-2 text-xs text-neutral-500 print:hidden">
          {pendentesCount} procedimento{pendentesCount > 1 ? "s" : ""} ainda pendente{pendentesCount > 1 ? "s" : ""}.
          Não entra no valor a pagar até ser marcado como feito.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Plano de tratamento */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-neutral-800">Plano de tratamento</h3>
            <button
              type="button"
              onClick={() => (procFormOpen ? resetProcForm() : setProcFormOpen(true))}
              className="print:hidden flex items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-strong"
            >
              <IconPlus /> Procedimento
            </button>
          </div>

          {procFormOpen && (
            <div className="space-y-2 rounded-xl border border-neutral-200 bg-white p-3 print:hidden">
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={procAppointmentId}
                  onChange={(e) => setProcAppointmentId(e.target.value)}
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
                  value={procTooth}
                  onChange={(e) => setProcTooth(e.target.value.replace(/[^\d,\s]/g, ""))}
                  placeholder="Dentes (ex: 16, 17)"
                  className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
                />
              </div>
              <select
                value={procType}
                onChange={(e) => setProcType(e.target.value)}
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
                  value={procPrice}
                  onChange={(e) => setProcPrice(e.target.value)}
                  placeholder="Valor (R$)"
                  inputMode="decimal"
                  className="flex-1 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
                />
                <label className="flex items-center gap-1.5 text-xs text-neutral-600">
                  <input type="checkbox" checked={procDone} onChange={(e) => setProcDone(e.target.checked)} className="h-4 w-4" />
                  Já feito
                </label>
              </div>
              <button
                type="button"
                onClick={submitProc}
                disabled={savingProc}
                className="w-full rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
              >
                {savingProc ? "Salvando..." : editingProcId ? "Salvar alterações" : "Adicionar ao plano"}
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
                  <ProcedureList items={items} onToggleDone={toggleDone} onEdit={openEditProc} onRemove={removeProcedure} />
                </div>
              ))}
              {loose.length > 0 && (
                <div className="rounded-xl border border-neutral-200 bg-white p-3">
                  <p className="mb-2 text-sm font-semibold text-neutral-900">Sem visita vinculada</p>
                  <ProcedureList items={loose} onToggleDone={toggleDone} onEdit={openEditProc} onRemove={removeProcedure} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Pagamentos */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-neutral-800">Pagamentos</h3>
            <button
              type="button"
              onClick={() => (payFormOpen ? resetPayForm() : setPayFormOpen(true))}
              className="print:hidden flex items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-strong"
            >
              <IconPlus /> Pagamento
            </button>
          </div>

          {payFormOpen && (
            <div className="space-y-2 rounded-xl border border-neutral-200 bg-white p-3 print:hidden">
              <input
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder="Valor recebido (R$)"
                inputMode="decimal"
                className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
              />
              <input
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                placeholder="Observação (opcional, ex: sinal, parcela 2)"
                className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={submitPay}
                disabled={savingPay}
                className="w-full rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
              >
                {savingPay ? "Salvando..." : editingPayId ? "Salvar alterações" : "Lançar pagamento"}
              </button>
            </div>
          )}

          {payments.length === 0 ? (
            <p className="text-sm text-neutral-400">Nenhum pagamento lançado ainda.</p>
          ) : (
            <div className="rounded-xl border border-neutral-200 bg-white p-3">
              <div className="space-y-1.5">
                {payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate text-neutral-800">
                        {new Date(p.paid_at).toLocaleDateString("pt-BR")}
                        {p.notes ? ` · ${p.notes}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-medium text-emerald-700">{centsToBRL(p.amount_cents)}</span>
                      <button
                        type="button"
                        onClick={() => openEditPay(p)}
                        title="Editar"
                        className="text-neutral-400 hover:text-neutral-700 print:hidden"
                      >
                        <IconPencil />
                      </button>
                      <button
                        type="button"
                        onClick={() => removePayment(p.id)}
                        title="Remover"
                        className="text-neutral-400 hover:text-red-600 print:hidden"
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProcedureList({
  items,
  onToggleDone,
  onEdit,
  onRemove,
}: {
  items: Procedure[];
  onToggleDone: (p: Procedure) => void;
  onEdit: (p: Procedure) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      {items.map((p) => (
        <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
          <div className="min-w-0 flex-1">
            <p className="truncate text-neutral-800">
              {p.procedure_type}
              {p.tooth_numbers.length > 0 ? ` (dente${p.tooth_numbers.length > 1 ? "s" : ""} ${p.tooth_numbers.join(", ")})` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-neutral-600">{centsToBRL(p.price_cents)}</span>
            <button
              type="button"
              onClick={() => onToggleDone(p)}
              title={p.done ? "Marcar como pendente" : "Marcar como feito"}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                p.done
                  ? "border-emerald-300 bg-emerald-500 text-white hover:bg-emerald-600"
                  : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
              }`}
            >
              {p.done ? <IconCheck /> : <IconCircle />}
              {p.done ? "Feito" : "Pendente"}
            </button>
            <button
              type="button"
              onClick={() => onEdit(p)}
              title="Editar"
              className="text-neutral-400 hover:text-neutral-700 print:hidden"
            >
              <IconPencil />
            </button>
            <button
              type="button"
              onClick={() => onRemove(p.id)}
              title="Remover"
              className="text-neutral-400 hover:text-red-600 print:hidden"
            >
              <IconTrash />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
