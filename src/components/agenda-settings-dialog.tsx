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
};


const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const SLOT_OPTIONS = [10, 15, 20, 30, 40, 45, 60];

/** Aba "Gerais" — standalone, horário de funcionamento + duração do slot.
 * Reaproveitada tanto na tela de Configurações quanto (via dialog) dentro
 * da própria Agenda. */
export function GeneralSettingsTab({ api, onSaved }: { api: Api; onSaved?: (s: AgendaSettings) => void }) {
  const [settings, setSettings] = useState<AgendaSettings | null>(null);
  const [saving, setSaving] = useState(false);

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

      <div className="space-y-2">
        <Label>Horário de funcionamento</Label>
        {DIAS.map((label, idx) => {
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

      <OnlineBookingSection settings={settings} setSettings={setSettings} />

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
}: {
  settings: AgendaSettings;
  setSettings: React.Dispatch<React.SetStateAction<AgendaSettings | null>>;
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
