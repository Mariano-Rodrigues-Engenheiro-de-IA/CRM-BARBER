import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { AgendaSettingsDialog, type AgendaSettings } from "@/components/agenda-settings-dialog";
import { ProfessionalsServicesDialog, type Professional, type Service } from "@/components/professionals-services-dialog";

type Api = (path: string, opts?: RequestInit) => Promise<any>;

type Appointment = {
  id: string;
  title: string;
  notes: string | null;
  customer_id: string | null;
  professional_id: string | null;
  service_id: string | null;
  scheduled_at: string;
  duration_minutes: number;
  status: "scheduled" | "done" | "canceled";
  customers?: { name: string; phone: string } | null;
};

type CustomerOption = { id: string; name: string; phone: string };

const SLOT_HEIGHT_PX = 56;

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function minutesToTime(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function AgendaView({ api }: { api: Api }) {
  const [day, setDay] = useState(() => new Date());
  const [settings, setSettings] = useState<AgendaSettings | null>(null);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [formPrefill, setFormPrefill] = useState<{ time: string; professionalId: string | null } | null>(null);

  async function loadSettings() {
    const r = await api("/api/public/extension/agenda-settings");
    if (r?.ok) setSettings(r.settings);
  }
  async function loadProfessionals() {
    const r = await api("/api/public/extension/professionals");
    if (r?.ok) setProfessionals(r.professionals);
  }
  async function loadAppointments() {
    setLoading(true);
    try {
      const from = new Date(day);
      from.setHours(0, 0, 0, 0);
      const to = new Date(day);
      to.setHours(23, 59, 59, 999);
      const r = await api(`/api/public/extension/appointments?from=${from.toISOString()}&to=${to.toISOString()}`);
      if (r?.ok) setAppointments(r.appointments || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSettings();
    void loadProfessionals();
    api("/api/public/extension/customers").then((r) => {
      if (r?.ok) setCustomers((r.customers || []).map((c: any) => ({ id: c.id, name: c.name, phone: c.phone })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadAppointments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  const dayOfWeek = day.getDay();
  const hours = settings?.business_hours?.[String(dayOfWeek)];
  const slotDuration = settings?.slot_duration_minutes ?? 30;

  const slots = useMemo(() => {
    if (!hours || hours.closed || !hours.open || !hours.close) return [];
    const startMin = timeToMinutes(hours.open);
    const endMin = timeToMinutes(hours.close);
    const list: string[] = [];
    for (let m = startMin; m < endMin; m += slotDuration) list.push(minutesToTime(m));
    return list;
  }, [hours, slotDuration]);

  const gridStartMin = slots.length > 0 ? timeToMinutes(slots[0]) : 0;
  const columns = professionals.length > 0 ? professionals : [{ id: "__none__", name: "Geral", phone: null, color: "#7399D7", active: true } as Professional];

  function appointmentsFor(professionalId: string) {
    return appointments.filter((a) => (a.professional_id ?? "__none__") === professionalId);
  }

  function openNewAppointment(time: string, professionalId: string) {
    setEditing(null);
    setFormPrefill({ time, professionalId: professionalId === "__none__" ? null : professionalId });
    setFormOpen(true);
  }

  async function handleSave(data: {
    title: string;
    customer_id: string | null;
    professional_id: string | null;
    service_id: string | null;
    time: string;
    duration_minutes: number;
    notes: string;
  }) {
    const scheduled_at = new Date(`${ymd(day)}T${data.time}:00`).toISOString();
    try {
      if (editing) {
        const r = await api(`/api/public/extension/appointments/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            title: data.title,
            customer_id: data.customer_id,
            professional_id: data.professional_id,
            service_id: data.service_id,
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
            professional_id: data.professional_id,
            service_id: data.service_id,
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

  const isToday = ymd(day) === ymd(new Date());

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setDay(new Date(day.getTime() - 86400000))}>
            ←
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDay(new Date())}>
            Hoje
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDay(new Date(day.getTime() + 86400000))}>
            →
          </Button>
          <Input
            type="date"
            value={ymd(day)}
            onChange={(e) => setDay(new Date(`${e.target.value}T00:00:00`))}
            className="w-40"
          />
          <span className="ml-2 text-sm font-medium text-neutral-700">
            {day.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
            {isToday && <span className="ml-1 text-brand">(hoje)</span>}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setTeamOpen(true)}>
            Profissionais e serviços
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            ⚙️ Configurações
          </Button>
        </div>
      </div>

      {!settings ? (
        <p className="text-sm text-neutral-500">Carregando...</p>
      ) : hours?.closed || slots.length === 0 ? (
        <div className="rounded-xl border border-neutral-300 bg-white p-8 text-center">
          <p className="text-sm text-neutral-500">
            {hours?.closed ? "Fechado nesse dia da semana." : "Horário de funcionamento não configurado."}
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => setSettingsOpen(true)}>
            Configurar horário de funcionamento
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-300 bg-white">
          <div className="flex" style={{ minWidth: 80 + columns.length * 220 }}>
            <div className="w-20 shrink-0 border-r border-neutral-200">
              <div className="h-12 border-b border-neutral-200" />
              {slots.map((t) => (
                <div key={t} className="flex items-start justify-end border-b border-neutral-100 pr-2 pt-1 text-[11px] text-neutral-400" style={{ height: SLOT_HEIGHT_PX }}>
                  {t}
                </div>
              ))}
            </div>

            {columns.map((prof) => (
              <div key={prof.id} className="relative flex-1 border-r border-neutral-100 last:border-r-0" style={{ minWidth: 220 }}>
                <div className="flex h-12 items-center gap-1.5 border-b border-neutral-200 px-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: prof.color }} />
                  <span className="truncate text-xs font-semibold text-neutral-700">{prof.name}</span>
                </div>

                <div className="relative">
                  {slots.map((t) => (
                    <button
                      key={t}
                      onClick={() => openNewAppointment(t, prof.id)}
                      className="block w-full border-b border-neutral-100 text-left hover:bg-neutral-50"
                      style={{ height: SLOT_HEIGHT_PX }}
                    />
                  ))}

                  {appointmentsFor(prof.id).map((a) => {
                    const start = new Date(a.scheduled_at);
                    const startMin = start.getHours() * 60 + start.getMinutes();
                    const top = ((startMin - gridStartMin) / slotDuration) * SLOT_HEIGHT_PX;
                    const height = Math.max((a.duration_minutes / slotDuration) * SLOT_HEIGHT_PX - 2, 20);
                    const isDone = a.status === "done";
                    return (
                      <div
                        key={a.id}
                        onClick={() => {
                          setEditing(a);
                          setFormPrefill(null);
                          setFormOpen(true);
                        }}
                        className={
                          "absolute left-1 right-1 cursor-pointer overflow-hidden rounded-md border px-2 py-1 text-[11px] shadow-sm " +
                          (isDone ? "border-emerald-300 bg-emerald-50" : "border-brand/40 bg-brand/10")
                        }
                        style={{ top, height }}
                      >
                        <p className="truncate font-semibold text-neutral-800">
                          {minutesToTime(startMin)} · {a.title}
                        </p>
                        {a.customers?.name && <p className="truncate text-neutral-500">{a.customers.name}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <AppointmentFormDialog
        open={formOpen}
        onOpenChange={(v) => {
          setFormOpen(v);
          if (!v) {
            setEditing(null);
            setFormPrefill(null);
          }
        }}
        editing={editing}
        prefill={formPrefill}
        customers={customers}
        professionals={professionals}
        api={api}
        onSave={handleSave}
        onCancelAppointment={editing ? () => handleCancel(editing) : undefined}
        onMarkDone={editing && editing.status === "scheduled" ? () => handleMarkDone(editing) : undefined}
      />

      <AgendaSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} api={api} onSaved={setSettings} />
      <ProfessionalsServicesDialog open={teamOpen} onOpenChange={setTeamOpen} api={api} onChanged={loadProfessionals} />
    </div>
  );
}

function AppointmentFormDialog({
  open,
  onOpenChange,
  editing,
  prefill,
  customers,
  professionals,
  api,
  onSave,
  onCancelAppointment,
  onMarkDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Appointment | null;
  prefill: { time: string; professionalId: string | null } | null;
  customers: CustomerOption[];
  professionals: Professional[];
  api: Api;
  onSave: (data: {
    title: string;
    customer_id: string | null;
    professional_id: string | null;
    service_id: string | null;
    time: string;
    duration_minutes: number;
    notes: string;
  }) => void;
  onCancelAppointment?: () => void;
  onMarkDone?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [customerId, setCustomerId] = useState<string>("none");
  const [professionalId, setProfessionalId] = useState<string>("none");
  const [serviceId, setServiceId] = useState<string>("none");
  const [time, setTime] = useState("09:00");
  const [duration, setDuration] = useState(30);
  const [notes, setNotes] = useState("");
  const [services, setServices] = useState<Service[]>([]);

  useEffect(() => {
    if (open) {
      api("/api/public/extension/services").then((r) => {
        if (r?.ok) setServices(r.services);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open) {
      setTitle(editing?.title ?? "");
      setCustomerId(editing?.customer_id ?? "none");
      setProfessionalId(editing?.professional_id ?? prefill?.professionalId ?? "none");
      setServiceId(editing?.service_id ?? "none");
      setTime(editing ? new Date(editing.scheduled_at).toTimeString().slice(0, 5) : prefill?.time ?? "09:00");
      setDuration(editing?.duration_minutes ?? 30);
      setNotes(editing?.notes ?? "");
    }
  }, [open, editing, prefill]);

  function handleServiceChange(id: string) {
    setServiceId(id);
    const svc = services.find((s) => s.id === id);
    if (svc) {
      setDuration(svc.duration_minutes);
      if (!title.trim()) setTitle(svc.name);
    }
  }

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

          {professionals.length > 0 && (
            <div className="space-y-1.5">
              <Label>Profissional</Label>
              <Select value={professionalId} onValueChange={setProfessionalId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sem profissional vinculado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem profissional vinculado</SelectItem>
                  {professionals.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {services.length > 0 && (
            <div className="space-y-1.5">
              <Label>Serviço</Label>
              <Select value={serviceId} onValueChange={handleServiceChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Sem serviço vinculado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem serviço vinculado</SelectItem>
                  {services.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.duration_minutes}min)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

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
        <DialogFooter className="flex-wrap gap-2">
          {onCancelAppointment && (
            <Button variant="outline" className="mr-auto text-red-600" onClick={onCancelAppointment}>
              Cancelar agendamento
            </Button>
          )}
          {onMarkDone && (
            <Button variant="outline" onClick={onMarkDone}>
              Concluir
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button
            onClick={() =>
              onSave({
                title: title.trim(),
                customer_id: customerId === "none" ? null : customerId,
                professional_id: professionalId === "none" ? null : professionalId,
                service_id: serviceId === "none" ? null : serviceId,
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
