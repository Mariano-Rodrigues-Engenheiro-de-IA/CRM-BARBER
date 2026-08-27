import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

type Api = (path: string, opts?: RequestInit) => Promise<any>;

type DayHours = { closed: boolean; open?: string; close?: string };
export type AgendaSettings = {
  slot_duration_minutes: number;
  business_hours: Record<string, DayHours>;
  online_booking_enabled?: boolean;
  public_slug?: string | null;
  hide_professional_selection?: boolean;
  distribution_mode?: "random" | "availability" | "priority";
  priority_order?: string[];
};


const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const SLOT_OPTIONS = [10, 15, 20, 30, 40, 45, 60];

/** Aba "Gerais" — standalone, horário de funcionamento + duração do slot.
 * Reaproveitada tanto na tela de Configurações quanto (via dialog) dentro
 * da própria Agenda. */
export function GeneralSettingsTab({ api, onSaved }: { api: Api; onSaved?: (s: AgendaSettings) => void }) {
  const [settings, setSettings] = useState<AgendaSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);

  useEffect(() => {
    api("/api/public/extension/agenda-settings").then((r) => {
      if (r?.ok) setSettings(r.settings);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateDay(day: string, patch: Partial<DayHours>) {
    setSettings((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        business_hours: {
          ...prev.business_hours,
          [day]: { ...prev.business_hours[day], ...patch },
        },
      };
    });
  }

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    try {
      const r = await api("/api/public/extension/agenda-settings", {
        method: "PATCH",
        body: JSON.stringify(settings),
      });
      if (!r?.ok) throw new Error(r?.error || "Erro ao salvar");
      toast.success("Configurações salvas");
      onSaved?.(r.settings);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar configurações");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return <p className="text-sm text-neutral-500">Carregando...</p>;

  const abertos = DIAS.filter((_, i) => !(settings.business_hours[String(i)] ?? { closed: true }).closed).length;
  const hoursSummary = abertos === 0 ? "Nenhum dia aberto" : `${abertos} dia(s) aberto(s)`;

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label>Duração de cada horário (slot)</Label>
        <Select
          value={String(settings.slot_duration_minutes)}
          onValueChange={(v) => setSettings((prev) => (prev ? { ...prev, slot_duration_minutes: Number(v) } : prev))}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SLOT_OPTIONS.map((m) => (
              <SelectItem key={m} value={String(m)}>
                {m} minutos
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-neutral-400">Define de quanto em quanto tempo a agenda mostra um novo horário.</p>
      </div>

      <div className="space-y-2 rounded-lg border border-neutral-200 p-3">
        <button
          type="button"
          onClick={() => setHoursOpen((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <span>
            <Label className="cursor-pointer">Horário de funcionamento</Label>
            <span className="block text-xs text-neutral-400">{hoursSummary}</span>
          </span>
          <span className="text-xs font-medium text-brand">{hoursOpen ? "Recolher" : "Expandir"}</span>
        </button>
        {hoursOpen && DIAS.map((label, idx) => {
          const day = settings.business_hours[String(idx)] ?? { closed: true };
          return (
            <div key={idx} className="flex items-center gap-3 rounded-lg border border-neutral-200 px-3 py-2">
              <span className="w-24 text-sm text-neutral-700">{label}</span>
              <Switch checked={!day.closed} onCheckedChange={(checked) => updateDay(String(idx), { closed: !checked })} />
              {!day.closed ? (
                <div className="flex flex-1 items-center gap-2">
                  <Input
                    type="time"
                    value={day.open ?? "09:00"}
                    onChange={(e) => updateDay(String(idx), { open: e.target.value })}
                    className="h-8 w-28"
                  />
                  <span className="text-xs text-neutral-400">até</span>
                  <Input
                    type="time"
                    value={day.close ?? "19:00"}
                    onChange={(e) => updateDay(String(idx), { close: e.target.value })}
                    className="h-8 w-28"
                  />
                </div>
              ) : (
                <span className="flex-1 text-xs text-neutral-400">Fechado</span>
              )}
            </div>
          );
        })}
      </div>

      <OnlineBookingSection settings={settings} setSettings={setSettings} api={api} />

      <Button onClick={handleSave} disabled={saving}>
        {saving ? "Salvando..." : "Salvar configurações"}
      </Button>
    </div>
  );
}

/** Agendamento online: liga/desliga e mostra o link público que o cliente
 * abre no celular ou no computador para marcar horário sozinho. */
function OnlineBookingSection({
  settings,
  setSettings,
  api,
}: {
  settings: AgendaSettings;
  setSettings: (updater: (prev: AgendaSettings | null) => AgendaSettings | null) => void;
  api: Api;
}) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const slug = settings.public_slug || "";
  const link = slug ? `${origin}/agendar/${slug}` : "";

  return (
    <div className="space-y-2 rounded-lg border border-neutral-200 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label>Agendamento online</Label>
          <p className="text-xs text-neutral-400">Seus clientes marcam horário sozinhos pelo link, no celular ou no computador.</p>
        </div>
        <Switch
          checked={!!settings.online_booking_enabled}
          onCheckedChange={(checked) => setSettings((prev) => (prev ? { ...prev, online_booking_enabled: checked } : prev))}
        />
      </div>

      {settings.online_booking_enabled &&
        (link ? (
          <div className="flex items-center gap-2">
            <Input value={link} readOnly className="h-8 text-xs" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(link);
                toast.success("Link copiado");
              }}
            >
              Copiar
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => window.open(link, "_blank")}>
              Abrir
            </Button>
          </div>
        ) : (
          <p className="text-xs text-neutral-400">Salve as configurações para gerar o link público.</p>
        ))}

      {settings.online_booking_enabled && (
        <div className="space-y-3 border-t border-neutral-100 pt-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>Não mostrar profissionais no link de agendamento</Label>
              <p className="text-xs text-neutral-400">
                O cliente escolhe só o serviço, data e horário — o sistema escolhe automaticamente qual profissional atende.
              </p>
            </div>
            <Switch
              checked={!!settings.hide_professional_selection}
              onCheckedChange={(checked) => setSettings((prev) => (prev ? { ...prev, hide_professional_selection: checked } : prev))}
            />
          </div>

          {settings.hide_professional_selection && (
            <div className="space-y-1.5 rounded-lg border border-neutral-200 p-3">
              <Label>Como escolher o profissional automaticamente</Label>
              <div className="space-y-2 pt-1">
                {(
                  [
                    { value: "random", title: "Aleatório", desc: "Sorteia entre os profissionais disponíveis pro serviço e horário." },
                    { value: "availability", title: "Maior disponibilidade", desc: "Escolhe quem tem mais horários livres no dia. Empate: sorteio." },
                    { value: "priority", title: "Prioridade + disponibilidade", desc: "Disponibilidade decide primeiro; empate usa a lista de prioridade configurada abaixo." },
                  ] as const
                ).map((opt) => (
                  <label
                    key={opt.value}
                    className={
                      "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition " +
                      (settings.distribution_mode === opt.value || (!settings.distribution_mode && opt.value === "random")
                        ? "border-brand bg-brand/5"
                        : "border-neutral-200 hover:border-brand/40")
                    }
                  >
                    <input
                      type="radio"
                      name="distribution_mode"
                      className="mt-0.5"
                      checked={settings.distribution_mode === opt.value || (!settings.distribution_mode && opt.value === "random")}
                      onChange={() => setSettings((prev) => (prev ? { ...prev, distribution_mode: opt.value } : prev))}
                    />
                    <span>
                      <span className="block text-sm font-medium text-neutral-800">{opt.title}</span>
                      <span className="block text-xs text-neutral-500">{opt.desc}</span>
                    </span>
                  </label>
                ))}
              </div>

              {settings.distribution_mode === "priority" && (
                <PriorityOrderEditor
                  api={api}
                  priorityOrder={settings.priority_order ?? []}
                  onChange={(next) => setSettings((prev) => (prev ? { ...prev, priority_order: next } : prev))}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Lista de prioridade dos profissionais — só usada como critério de
 * desempate no modo "Prioridade + disponibilidade". Ordem própria,
 * separada da ordem geral do cadastro de profissionais: sobe/desce com
 * as setas, não precisa arrastar. */
function PriorityOrderEditor({
  api,
  priorityOrder,
  onChange,
}: {
  api: Api;
  priorityOrder: string[];
  onChange: (next: string[]) => void;
}) {
  const [professionals, setProfessionals] = useState<{ id: string; name: string }[] | null>(null);

  useEffect(() => {
    api("/api/public/extension/professionals").then((r) => {
      if (r?.ok) setProfessionals(r.professionals.map((p: any) => ({ id: p.id, name: p.name })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!professionals) return <p className="pt-2 text-xs text-neutral-400">Carregando profissionais...</p>;
  if (professionals.length === 0) {
    return <p className="pt-2 text-xs text-neutral-400">Cadastre profissionais primeiro pra montar a prioridade.</p>;
  }

  // Todo mundo entra na lista (quem não foi ordenado ainda vai pro fim),
  // sem precisar de um passo extra pra "adicionar" cada profissional.
  const ordered = [
    ...priorityOrder.filter((id) => professionals.some((p) => p.id === id)),
    ...professionals.filter((p) => !priorityOrder.includes(p.id)).map((p) => p.id),
  ];

  function move(id: string, dir: -1 | 1) {
    const idx = ordered.indexOf(id);
    const swapWith = idx + dir;
    if (swapWith < 0 || swapWith >= ordered.length) return;
    const next = [...ordered];
    [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
    onChange(next);
  }

  return (
    <div className="space-y-1.5 border-t border-neutral-100 pt-3">
      <Label>Prioridade dos profissionais</Label>
      <p className="text-xs text-neutral-400">
        Usada só como critério de desempate, quando dois ou mais profissionais têm a mesma disponibilidade. Independe da
        ordem do cadastro geral.
      </p>
      <div className="space-y-1.5 pt-1">
        {ordered.map((id, i) => {
          const pro = professionals.find((p) => p.id === id);
          if (!pro) return null;
          return (
            <div key={id} className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2">
              <span className="w-5 shrink-0 text-center text-xs font-bold text-neutral-400">{i + 1}º</span>
              <span className="flex-1 truncate text-sm text-neutral-800">{pro.name}</span>
              <button
                type="button"
                disabled={i === 0}
                onClick={() => move(id, -1)}
                className="flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"
                title="Subir"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={i === ordered.length - 1}
                onClick={() => move(id, 1)}
                className="flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"
                title="Descer"
              >
                ↓
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}


/** Dialog com as configurações — usado como atalho rápido dentro da
 * própria tela da Agenda (a gestão completa vive em Configurações). */
export function AgendaSettingsDialog({
  open,
  onOpenChange,
  api,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  api: Api;
  onSaved: (settings: AgendaSettings) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Configurações da agenda</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          <GeneralSettingsTab
            api={api}
            onSaved={(s) => {
              onSaved(s);
              onOpenChange(false);
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
