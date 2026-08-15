import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { type AgendaSettings } from "@/components/agenda-settings-dialog";
import { type Professional, type Service, ProfessionalAvatar } from "@/components/professionals-services-dialog";

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
type TimeBlock = { id: string; professional_id: string | null; starts_at: string; ends_at: string; reason: string | null };

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
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [formPrefill, setFormPrefill] = useState<{ time: string; professionalId: string | null } | null>(null);
  const [slotDialogOpen, setSlotDialogOpen] = useState(false);
  const [slotPrefill, setSlotPrefill] = useState<{ time: string; professionalId: string | null } | null>(null);
  // Resumo em popup ao passar o mouse. Posição fixa na tela pra não ser
  // cortada pelo scroll horizontal da grade.
  const [hovered, setHovered] = useState<{ appointment: Appointment; professional: Professional; startMin: number; x: number; y: number } | null>(null);

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
  async function loadTimeBlocks() {
    const from = new Date(day);
    from.setHours(0, 0, 0, 0);
    const to = new Date(day);
    to.setHours(23, 59, 59, 999);
    const r = await api(`/api/public/extension/time-blocks?from=${from.toISOString()}&to=${to.toISOString()}`);
    if (r?.ok) setTimeBlocks(r.time_blocks || []);
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
    void loadTimeBlocks();
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
  const columns = professionals.length > 0 ? professionals : [{ id: "__none__", name: "Geral", phone: null, color: "#7399D7", avatar_url: null, active: true } as Professional];

  function appointmentsFor(professionalId: string) {
    return appointments.filter((a) => (a.professional_id ?? "__none__") === professionalId);
  }

  function blocksFor(professionalId: string) {
    // Bloqueio sem profissional (professional_id null) = loja toda fechada
    // naquele período — aparece em TODAS as colunas. Bloqueio com
    // profissional só aparece na coluna dele.
    return timeBlocks.filter((b) => b.professional_id === null || b.professional_id === professionalId);
  }

  function openNewAppointment(time: string, professionalId: string) {
    setSlotPrefill({ time, professionalId: professionalId === "__none__" ? null : professionalId });
    setSlotDialogOpen(true);
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

  async function handleDeleteBlock(b: TimeBlock) {
    if (!confirm("Remover esse bloqueio de horário?")) return;
    const r = await api(`/api/public/extension/time-blocks/${b.id}`, { method: "DELETE" });
    if (r?.ok) {
      toast.success("Bloqueio removido");
      void loadTimeBlocks();
    } else {
      toast.error(r?.error || "Erro ao remover");
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
          <Input
            type="date"
            value={ymd(day)}
            onChange={(e) => setDay(new Date(`${e.target.value}T00:00:00`))}
            className="w-40"
          />
          <Button variant="outline" size="sm" onClick={() => setDay(new Date(day.getTime() + 86400000))}>
            →
          </Button>
          {isToday ? (
            <span className="ml-2 text-sm font-medium text-neutral-700">
              {day.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
              <span className="ml-1 text-brand">(hoje)</span>
            </span>
          ) : (
            <button
              onClick={() => setDay(new Date())}
              className="ml-2 text-sm font-medium text-neutral-700 underline decoration-dotted hover:text-brand"
              title="Voltar para hoje"
            >
              {day.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
            </button>
          )}
        </div>
      </div>

      {!settings ? (
        <p className="text-sm text-neutral-500">Carregando...</p>
      ) : hours?.closed || slots.length === 0 ? (
        <div className="rounded-xl border border-neutral-300 bg-white p-8 text-center">
          <p className="text-sm text-neutral-500">
            {hours?.closed
              ? "Fechado nesse dia da semana."
              : "Horário de funcionamento não configurado. Configure em Configurações → Gerais."}
          </p>
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
                  <ProfessionalAvatar professional={prof} size={26} />
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

                  {blocksFor(prof.id).map((b) => {
                    const blockStart = new Date(b.starts_at);
                    const blockEnd = new Date(b.ends_at);
                    const dayStart = new Date(day);
                    dayStart.setHours(0, 0, 0, 0);
                    const startMin = Math.max((blockStart.getTime() - dayStart.getTime()) / 60000, gridStartMin);
                    const endMin = Math.min((blockEnd.getTime() - dayStart.getTime()) / 60000, gridStartMin + slots.length * slotDuration);
                    if (endMin <= startMin) return null;
                    const top = ((startMin - gridStartMin) / slotDuration) * SLOT_HEIGHT_PX;
                    const height = ((endMin - startMin) / slotDuration) * SLOT_HEIGHT_PX;
                    return (
                      <div
                        key={b.id}
                        onClick={() => handleDeleteBlock(b)}
                        title="Clique para remover esse bloqueio"
                        className="absolute left-0 right-0 z-10 cursor-pointer overflow-hidden border-y border-neutral-300 bg-neutral-200/70 px-2 py-1 text-[11px] text-neutral-500"
                        style={{
                          top,
                          height,
                          backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(0,0,0,0.05) 6px, rgba(0,0,0,0.05) 12px)",
                        }}
                      >
                        <p className="truncate font-medium">🚫 {b.reason || "Bloqueado"}</p>
                      </div>
                    );
                  })}

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
                        onMouseEnter={(e) => {
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setHovered({ appointment: a, professional: prof, startMin, x: r.left + r.width / 2, y: r.bottom });
                        }}
                        onMouseLeave={() => setHovered(null)}
                        className={
                          "absolute left-1 right-1 z-20 cursor-pointer rounded-md border px-2 py-1 text-[11px] shadow-sm " +
                          (isDone ? "border-emerald-300 bg-emerald-50" : "border-brand/40 bg-brand/10")
                        }
                        style={{ top, height }}
                      >
                        <div className="h-full overflow-hidden">
                          <p className="truncate font-semibold text-neutral-800">
                            {minutesToTime(startMin)} · {a.title}
                          </p>
                          {a.customers?.name && <p className="truncate text-neutral-500">{a.customers.name}</p>}
                        </div>
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

      {hovered && (
        <AppointmentTooltip
          appointment={hovered.appointment}
          professional={hovered.professional}
          startMin={hovered.startMin}
          x={hovered.x}
          y={hovered.y}
        />
      )}

      <SlotActionDialog
        open={slotDialogOpen}
        onOpenChange={(v) => {
          setSlotDialogOpen(v);
          if (!v) setSlotPrefill(null);
        }}
        day={day}
        prefill={slotPrefill}
        customers={customers}
        professionals={professionals}
        timeBlocks={timeBlocks}
        api={api}
        onAppointmentSaved={async (data) => {
          await handleSave(data);
          setSlotDialogOpen(false);
        }}
        onBlockSaved={() => {
          setSlotDialogOpen(false);
          void loadTimeBlocks();
        }}
        onBlockDeleted={() => void loadTimeBlocks()}
        deleteBlock={handleDeleteBlock}
      />

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

  // Se o serviço tiver vínculos configurados, só mostra pra profissionais
  // vinculados a ele; serviço sem vínculo nenhum fica disponível pra todos.
  const availableServices = services.filter(
    (s) => professionalId === "none" || !s.professional_ids || s.professional_ids.length === 0 || s.professional_ids.includes(professionalId),
  );

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
                  {availableServices.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.duration_minutes}min)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {professionalId !== "none" && availableServices.length < services.length && (
                <p className="text-[11px] text-neutral-400">Mostrando só os serviços que esse profissional realiza.</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Cliente (opcional)</Label>
            <CustomerPicker customers={customers} value={customerId} onChange={setCustomerId} />
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

/** Dialog unificado ao clicar num horário vazio: Agendar | Bloquear |
 * Desbloquear, lado a lado em abas — pedido do Mariano baseado no padrão
 * de apps como AppBarber. */
function SlotActionDialog({
  open,
  onOpenChange,
  day,
  prefill,
  customers,
  professionals,
  timeBlocks,
  api,
  onAppointmentSaved,
  onBlockSaved,
  deleteBlock,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  day: Date;
  prefill: { time: string; professionalId: string | null } | null;
  customers: CustomerOption[];
  professionals: Professional[];
  timeBlocks: TimeBlock[];
  api: Api;
  onAppointmentSaved: (data: {
    title: string;
    customer_id: string | null;
    professional_id: string | null;
    service_id: string | null;
    time: string;
    duration_minutes: number;
    notes: string;
  }) => void;
  onBlockSaved: () => void;
  onBlockDeleted: () => void;
  deleteBlock: (b: TimeBlock) => void;
}) {
  const [tab, setTab] = useState<"agendar" | "bloquear" | "desbloquear">("agendar");

  useEffect(() => {
    if (open) setTab("agendar");
  }, [open]);

  const dayBlocks = timeBlocks.filter((b) => {
    if (!prefill?.professionalId) return true;
    return b.professional_id === null || b.professional_id === prefill.professionalId;
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{prefill?.time ? `Horário ${prefill.time}` : "Ação na agenda"}</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="w-full">
            <TabsTrigger value="agendar" className="flex-1">
              Agendar
            </TabsTrigger>
            <TabsTrigger value="bloquear" className="flex-1">
              Bloquear
            </TabsTrigger>
            <TabsTrigger value="desbloquear" className="flex-1">
              Desbloquear
            </TabsTrigger>
          </TabsList>

          <TabsContent value="agendar">
            <SlotAppointmentForm
              prefill={prefill}
              customers={customers}
              professionals={professionals}
              api={api}
              onSave={onAppointmentSaved}
            />
          </TabsContent>

          <TabsContent value="bloquear">
            <SlotBlockForm day={day} prefill={prefill} professionals={professionals} api={api} onSaved={onBlockSaved} />
          </TabsContent>

          <TabsContent value="desbloquear" className="space-y-2">
            {dayBlocks.length === 0 ? (
              <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-400">
                Nenhum bloqueio nesse dia.
              </p>
            ) : (
              dayBlocks.map((b) => {
                const prof = professionals.find((p) => p.id === b.professional_id);
                return (
                  <div key={b.id} className="flex items-center gap-3 rounded-lg border border-neutral-200 p-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-neutral-800">
                        {new Date(b.starts_at).toTimeString().slice(0, 5)} – {new Date(b.ends_at).toTimeString().slice(0, 5)}
                        {" · "}
                        {prof ? prof.name : "Toda a loja"}
                      </p>
                      {b.reason && <p className="text-xs text-neutral-400">{b.reason}</p>}
                    </div>
                    <Button variant="outline" size="sm" className="text-red-600" onClick={() => deleteBlock(b)}>
                      Desbloquear
                    </Button>
                  </div>
                );
              })
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function SlotAppointmentForm({
  prefill,
  customers,
  professionals,
  api,
  onSave,
}: {
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
}) {
  const [title, setTitle] = useState("");
  const [customerId, setCustomerId] = useState("none");
  const [professionalId, setProfessionalId] = useState(prefill?.professionalId ?? "none");
  const [serviceId, setServiceId] = useState("none");
  const [time, setTime] = useState(prefill?.time ?? "09:00");
  const [duration, setDuration] = useState(30);
  const [notes, setNotes] = useState("");
  const [services, setServices] = useState<Service[]>([]);

  useEffect(() => {
    api("/api/public/extension/services").then((r) => {
      if (r?.ok) setServices(r.services);
    });
    setTitle("");
    setCustomerId("none");
    setProfessionalId(prefill?.professionalId ?? "none");
    setServiceId("none");
    setTime(prefill?.time ?? "09:00");
    setDuration(30);
    setNotes("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  function handleServiceChange(id: string) {
    setServiceId(id);
    const svc = services.find((s) => s.id === id);
    if (svc) {
      setDuration(svc.duration_minutes);
      if (!title.trim()) setTitle(svc.name);
    }
  }

  const availableServices = services.filter(
    (s) => professionalId === "none" || !s.professional_ids || s.professional_ids.length === 0 || s.professional_ids.includes(professionalId),
  );

  return (
    <div className="space-y-3 py-2">
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
              {availableServices.map((s) => (
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
        <CustomerPicker customers={customers} value={customerId} onChange={setCustomerId} />
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
      <div className="flex justify-end pt-2">
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
          Criar agendamento
        </Button>
      </div>
    </div>
  );
}

function SlotBlockForm({
  day,
  prefill,
  professionals,
  api,
  onSaved,
}: {
  day: Date;
  prefill: { time: string; professionalId: string | null } | null;
  professionals: Professional[];
  api: Api;
  onSaved: () => void;
}) {
  const [professionalId, setProfessionalId] = useState(prefill?.professionalId ?? "all");
  const [startTime, setStartTime] = useState(prefill?.time ?? "12:00");
  const [endTime, setEndTime] = useState("13:00");
  const [reason, setReason] = useState("");
  const [recurrenceType, setRecurrenceType] = useState<"unico" | "recorrente">("unico");
  const [countDays, setCountDays] = useState(30);
  const [periodicityDays, setPeriodicityDays] = useState(1);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setProfessionalId(prefill?.professionalId ?? "all");
    setStartTime(prefill?.time ?? "12:00");
  }, [prefill]);

  async function handleSave() {
    setSaving(true);
    try {
      const starts_at = new Date(`${ymd(day)}T${startTime}:00`).toISOString();
      const ends_at = new Date(`${ymd(day)}T${endTime}:00`).toISOString();
      const r = await api("/api/public/extension/time-blocks", {
        method: "POST",
        body: JSON.stringify({
          professional_id: professionalId === "all" ? null : professionalId,
          starts_at,
          ends_at,
          reason: reason.trim() || undefined,
          recurrence: recurrenceType === "recorrente" ? { count_days: countDays, periodicity_days: periodicityDays } : undefined,
        }),
      });
      if (!r?.ok) throw new Error(r?.error || "Erro ao bloquear horário");
      toast.success(recurrenceType === "recorrente" ? `${r.created_count} bloqueios criados` : "Horário bloqueado");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao bloquear horário");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 py-2">
      <div className="space-y-1.5">
        <Label>Tipo</Label>
        <Select value={recurrenceType} onValueChange={(v) => setRecurrenceType(v as any)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unico">Bloqueio único (só esse dia)</SelectItem>
            <SelectItem value="recorrente">Recorrente (repete a cada X dias)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {recurrenceType === "recorrente" && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Repetir por quantos dias</Label>
            <Input
              type="number"
              min={1}
              max={180}
              value={countDays}
              onChange={(e) => setCountDays(Math.min(180, Math.max(1, Number(e.target.value) || 1)))}
            />
            <p className="text-[10px] text-neutral-400">Máximo de 180 dias.</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">A cada quantos dias</Label>
            <Input type="number" min={1} max={30} value={periodicityDays} onChange={(e) => setPeriodicityDays(Number(e.target.value))} />
            <p className="text-[10px] text-neutral-400">1 = todo dia. Ex: almoço todo dia = 1.</p>
          </div>
        </div>
      )}

      {professionals.length > 0 && (
        <div className="space-y-1.5">
          <Label>Quem fica indisponível</Label>
          <Select value={professionalId} onValueChange={setProfessionalId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toda a loja</SelectItem>
              {professionals.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Das</Label>
          <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Até</Label>
          <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Motivo (opcional)</Label>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex: Almoço, Folga, Feriado" />
      </div>
      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={saving || startTime >= endTime}>
          {saving ? "Bloqueando..." : "Bloquear"}
        </Button>
      </div>
    </div>
  );
}


/** Resumo do agendamento que aparece ao passar o mouse por cima do card. */
function AppointmentTooltip({
  appointment,
  professional,
  startMin,
  x,
  y,
}: {
  appointment: Appointment;
  professional: Professional;
  startMin: number;
  x: number;
  y: number;
}) {
  const endMin = startMin + appointment.duration_minutes;
  const statusLabel =
    appointment.status === "done" ? "Concluído" : appointment.status === "canceled" ? "Cancelado" : "Agendado";
  return (
    <div
      className="pointer-events-none fixed z-50 w-64 -translate-x-1/2 translate-y-2 rounded-lg border border-neutral-200 bg-white p-3 text-left shadow-xl"
      style={{ left: x, top: y }}
    >
      <p className="text-sm font-semibold text-neutral-900">{appointment.title}</p>
      <p className="mt-0.5 text-xs text-neutral-500">
        {minutesToTime(startMin)} – {minutesToTime(endMin)} · {appointment.duration_minutes} min
      </p>
      <dl className="mt-2 space-y-1 text-xs">
        <div className="flex gap-1.5">
          <dt className="text-neutral-400">Cliente:</dt>
          <dd className="flex-1 truncate text-neutral-700">{appointment.customers?.name || "Sem cliente"}</dd>
        </div>
        {appointment.customers?.phone && (
          <div className="flex gap-1.5">
            <dt className="text-neutral-400">Telefone:</dt>
            <dd className="flex-1 truncate text-neutral-700">{appointment.customers.phone}</dd>
          </div>
        )}
        <div className="flex gap-1.5">
          <dt className="text-neutral-400">Profissional:</dt>
          <dd className="flex-1 truncate text-neutral-700">{professional.id === "__none__" ? "Sem profissional" : professional.name}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-neutral-400">Status:</dt>
          <dd className="flex-1 text-neutral-700">{statusLabel}</dd>
        </div>
        {appointment.notes && (
          <div className="pt-1 text-neutral-500">
            <span className="text-neutral-400">Notas: </span>
            {appointment.notes}
          </div>
        )}
      </dl>
    </div>
  );
}

/** Seletor de cliente com busca por nome ou telefone — evita rolar a lista
 * inteira quando a barbearia tem centenas de clientes. */
function CustomerPicker({
  customers,
  value,
  onChange,
}: {
  customers: CustomerOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = customers.find((c) => c.id === value) ?? null;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? customers.filter((c) => c.name.toLowerCase().includes(q) || (c.phone || "").replace(/\D/g, "").includes(q.replace(/\D/g, "")))
      : customers;
    return list.slice(0, 50);
  }, [customers, query]);

  if (selected && !open) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm">
        <span className="flex-1 truncate">
          {selected.name} <span className="text-neutral-400">({selected.phone})</span>
        </span>
        <button type="button" className="text-xs text-neutral-500 underline" onClick={() => { setQuery(""); setOpen(true); }}>
          trocar
        </button>
        <button type="button" className="text-xs text-red-600 underline" onClick={() => onChange("none")}>
          remover
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Input
        autoFocus={open}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar cliente por nome ou telefone..."
      />
      <div className="max-h-44 overflow-y-auto rounded-md border border-neutral-200">
        {results.length === 0 ? (
          <p className="p-3 text-center text-xs text-neutral-400">Nenhum cliente encontrado.</p>
        ) : (
          results.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onChange(c.id);
                setOpen(false);
              }}
              className="block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-neutral-50"
            >
              {c.name} <span className="text-neutral-400">({c.phone})</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
