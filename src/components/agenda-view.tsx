import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type Api = (path: string, opts?: RequestInit) => Promise<any>;

type Appointment = {
  id: string;
  title: string;
  notes: string | null;
  customer_id: string | null;
  scheduled_at: string;
  duration_minutes: number;
  status: "scheduled" | "done" | "canceled";
  customers?: { name: string; phone: string } | null;
};

type CustomerOption = { id: string; name: string; phone: string };

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function AgendaView({ api }: { api: Api }) {
  const [cursor, setCursor] = useState(() => new Date());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string>(ymd(new Date()));
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);

  const monthStart = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1), [cursor]);
  const monthEnd = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1), [cursor]);

  async function loadAppointments() {
    setLoading(true);
    try {
      const from = new Date(monthStart);
      from.setDate(from.getDate() - 7);
      const to = new Date(monthEnd);
      to.setDate(to.getDate() + 7);
      const r = await api(`/api/public/extension/appointments?from=${from.toISOString()}&to=${to.toISOString()}`);
      if (r?.ok) setAppointments(r.appointments || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAppointments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor]);

  useEffect(() => {
    api("/api/public/extension/customers").then((r) => {
      if (r?.ok) setCustomers((r.customers || []).map((c: any) => ({ id: c.id, name: c.name, phone: c.phone })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of appointments) {
      const key = ymd(new Date(a.scheduled_at));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return map;
  }, [appointments]);

  // Grade do mês: começa no domingo da semana do dia 1, sempre 6 linhas (42 dias).
  const gridDays = useMemo(() => {
    const first = new Date(monthStart);
    first.setDate(first.getDate() - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(first);
      d.setDate(first.getDate() + i);
      return d;
    });
  }, [monthStart]);

  const dayList = byDay.get(selectedDay) ?? [];
  const today = ymd(new Date());

  async function handleSave(data: {
    title: string;
    customer_id: string | null;
    time: string;
    duration_minutes: number;
    notes: string;
  }) {
    const scheduled_at = new Date(`${selectedDay}T${data.time}:00`).toISOString();
    try {
      if (editing) {
        const r = await api(`/api/public/extension/appointments/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            title: data.title,
            customer_id: data.customer_id,
            scheduled_at,
            duration_minutes: data.duration_minutes,
            notes: data.notes || null,
          }),
        });
        if (!r?.ok) throw new Error(r?.error || "Erro ao salvar");
        toast.success("Agendamento atualizado");
      } else {
        const r = await api("/api/public/extension/appointments", {
          method: "POST",
          body: JSON.stringify({
            title: data.title,
            customer_id: data.customer_id,
            scheduled_at,
            duration_minutes: data.duration_minutes,
            notes: data.notes || undefined,
          }),
        });
        if (!r?.ok) throw new Error(r?.error || "Erro ao criar");
        toast.success("Agendamento criado");
      }
      setFormOpen(false);
      setEditing(null);
      void loadAppointments();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar agendamento");
    }
  }

  async function handleCancel(a: Appointment) {
    if (!confirm(`Cancelar o agendamento "${a.title}"?`)) return;
    const r = await api(`/api/public/extension/appointments/${a.id}`, { method: "DELETE" });
    if (r?.ok) {
      toast.success("Agendamento cancelado");
      void loadAppointments();
    } else {
      toast.error(r?.error || "Erro ao cancelar");
    }
  }

  async function handleMarkDone(a: Appointment) {
    const r = await api(`/api/public/extension/appointments/${a.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "done" }),
    });
    if (r?.ok) {
      toast.success("Marcado como concluído");
      void loadAppointments();
    } else {
      toast.error(r?.error || "Erro ao atualizar");
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      {/* Calendário */}
      <div className="rounded-xl border border-neutral-300 bg-white overflow-hidden">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-900">
            {MESES[cursor.getMonth()]} de {cursor.getFullYear()}
          </h2>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
              ←
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>
              Hoje
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
              →
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-7 border-b border-neutral-200 bg-neutral-50">
          {DIAS_SEMANA.map((d) => (
            <div key={d} className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {gridDays.map((d, i) => {
            const key = ymd(d);
            const isCurrentMonth = d.getMonth() === cursor.getMonth();
            const isToday = key === today;
            const isSelected = key === selectedDay;
            const count = byDay.get(key)?.length ?? 0;
            return (
              <button
                key={i}
                onClick={() => setSelectedDay(key)}
                className={
                  "h-20 border-b border-r border-neutral-100 p-1.5 text-left align-top transition " +
                  (isSelected ? "bg-brand/10" : "hover:bg-neutral-50") +
                  (isCurrentMonth ? "" : " opacity-40")
                }
              >
                <span
                  className={
                    "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs " +
                    (isToday ? "bg-brand text-white font-semibold" : "text-neutral-700")
                  }
                >
                  {d.getDate()}
                </span>
                {count > 0 && (
                  <div className="mt-1 flex flex-wrap gap-0.5">
                    {Array.from({ length: Math.min(count, 4) }).map((_, j) => (
                      <span key={j} className="h-1.5 w-1.5 rounded-full bg-brand" />
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Lista do dia selecionado */}
      <div className="rounded-xl border border-neutral-300 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-neutral-900">
            {new Date(`${selectedDay}T00:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}
          </h3>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            + Novo
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-neutral-500">Carregando...</p>
        ) : dayList.length === 0 ? (
          <p className="text-sm text-neutral-500">Nenhum agendamento nesse dia.</p>
        ) : (
          <div className="space-y-2">
            {dayList
              .slice()
              .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
              .map((a) => (
                <div key={a.id} className="rounded-lg border border-neutral-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-neutral-900">{a.title}</p>
                      <p className="text-xs text-neutral-500">
                        {new Date(a.scheduled_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        {" · "}
                        {a.duration_minutes}min
                        {a.customers?.name ? ` · ${a.customers.name}` : ""}
                      </p>
                      {a.status === "done" && <span className="text-[11px] font-semibold text-emerald-600">Concluído</span>}
                    </div>
                  </div>
                  {a.notes && <p className="mt-1 text-xs text-neutral-500">{a.notes}</p>}
                  <div className="mt-2 flex gap-2">
                    {a.status === "scheduled" && (
                      <>
                        <button
                          onClick={() => handleMarkDone(a)}
                          className="text-xs font-medium text-emerald-600 hover:underline"
                        >
                          Concluir
                        </button>
                        <button
                          onClick={() => {
                            setEditing(a);
                            setFormOpen(true);
                          }}
                          className="text-xs font-medium text-brand hover:underline"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => handleCancel(a)}
                          className="text-xs font-medium text-red-600 hover:underline"
                        >
                          Cancelar
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      <AppointmentFormDialog
        open={formOpen}
        onOpenChange={(v) => {
          setFormOpen(v);
          if (!v) setEditing(null);
        }}
        editing={editing}
        customers={customers}
        onSave={handleSave}
      />
    </div>
  );
}

function AppointmentFormDialog({
  open,
  onOpenChange,
  editing,
  customers,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Appointment | null;
  customers: CustomerOption[];
  onSave: (data: { title: string; customer_id: string | null; time: string; duration_minutes: number; notes: string }) => void;
}) {
  const [title, setTitle] = useState("");
  const [customerId, setCustomerId] = useState<string>("none");
  const [time, setTime] = useState("09:00");
  const [duration, setDuration] = useState(30);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setTitle(editing?.title ?? "");
      setCustomerId(editing?.customer_id ?? "none");
      setTime(editing ? new Date(editing.scheduled_at).toTimeString().slice(0, 5) : "09:00");
      setDuration(editing?.duration_minutes ?? 30);
      setNotes(editing?.notes ?? "");
    }
  }, [open, editing]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar agendamento" : "Novo agendamento"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Título</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Corte + barba" />
          </div>
          <div className="space-y-1.5">
            <Label>Cliente (opcional)</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger>
                <SelectValue placeholder="Sem cliente vinculado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem cliente vinculado</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} ({c.phone})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Horário</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Duração (min)</Label>
              <Input type="number" min={5} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notas (opcional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() =>
              onSave({
                title: title.trim(),
                customer_id: customerId === "none" ? null : customerId,
                time,
                duration_minutes: duration,
                notes,
              })
            }
            disabled={!title.trim()}
          >
            {editing ? "Salvar" : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
