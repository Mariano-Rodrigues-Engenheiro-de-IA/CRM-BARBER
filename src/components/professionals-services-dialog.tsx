import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";

type Api = (path: string, opts?: RequestInit) => Promise<any>;

export type Professional = { id: string; name: string; phone: string | null; color: string; active: boolean };
export type Service = { id: string; name: string; duration_minutes: number; price: number | null; active: boolean };

const COLORS = ["#7399D7", "#E8998D", "#8FB996", "#D7B26D", "#B589C4", "#6EC4D0"];

export function ProfessionalsServicesDialog({
  open,
  onOpenChange,
  api,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  api: Api;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<"professionals" | "services">("professionals");
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [newProName, setNewProName] = useState("");
  const [newProPhone, setNewProPhone] = useState("");
  const [newServiceName, setNewServiceName] = useState("");
  const [newServiceDuration, setNewServiceDuration] = useState(30);
  const [newServicePrice, setNewServicePrice] = useState("");

  async function loadAll() {
    const [pr, sv] = await Promise.all([
      api("/api/public/extension/professionals?include_inactive=1"),
      api("/api/public/extension/services?include_inactive=1"),
    ]);
    if (pr?.ok) setProfessionals(pr.professionals);
    if (sv?.ok) setServices(sv.services);
  }

  useEffect(() => {
    if (open) void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function addProfessional() {
    if (!newProName.trim()) return;
    const color = COLORS[professionals.length % COLORS.length];
    const r = await api("/api/public/extension/professionals", {
      method: "POST",
      body: JSON.stringify({ name: newProName.trim(), phone: newProPhone.trim() || undefined, color }),
    });
    if (r?.ok) {
      setNewProName("");
      setNewProPhone("");
      await loadAll();
      onChanged();
      toast.success("Profissional adicionado");
    } else {
      toast.error(r?.error || "Erro ao adicionar");
    }
  }

  async function toggleProfessional(p: Professional) {
    const r = await api(`/api/public/extension/professionals/${p.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !p.active }),
    });
    if (r?.ok) {
      await loadAll();
      onChanged();
    }
  }

  async function addService() {
    if (!newServiceName.trim()) return;
    const r = await api("/api/public/extension/services", {
      method: "POST",
      body: JSON.stringify({
        name: newServiceName.trim(),
        duration_minutes: newServiceDuration,
        price: newServicePrice ? Number(newServicePrice) : undefined,
      }),
    });
    if (r?.ok) {
      setNewServiceName("");
      setNewServiceDuration(30);
      setNewServicePrice("");
      await loadAll();
      onChanged();
      toast.success("Serviço adicionado");
    } else {
      toast.error(r?.error || "Erro ao adicionar");
    }
  }

  async function toggleService(s: Service) {
    const r = await api(`/api/public/extension/services/${s.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !s.active }),
    });
    if (r?.ok) {
      await loadAll();
      onChanged();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Profissionais e serviços</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="w-full">
            <TabsTrigger value="professionals" className="flex-1">
              Profissionais
            </TabsTrigger>
            <TabsTrigger value="services" className="flex-1">
              Serviços
            </TabsTrigger>
          </TabsList>

          <TabsContent value="professionals" className="space-y-3 max-h-[50vh] overflow-y-auto">
            {professionals.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                <div className="flex-1">
                  <p className={"text-sm " + (p.active ? "text-neutral-900" : "text-neutral-400 line-through")}>{p.name}</p>
                  {p.phone && <p className="text-xs text-neutral-400">{p.phone}</p>}
                </div>
                <Button variant="ghost" size="sm" onClick={() => toggleProfessional(p)}>
                  {p.active ? "Desativar" : "Reativar"}
                </Button>
              </div>
            ))}
            <div className="space-y-2 rounded-lg border border-dashed border-neutral-300 p-3">
              <Input placeholder="Nome do profissional" value={newProName} onChange={(e) => setNewProName(e.target.value)} />
              <Input placeholder="Telefone (opcional)" value={newProPhone} onChange={(e) => setNewProPhone(e.target.value)} />
              <Button size="sm" onClick={addProfessional} disabled={!newProName.trim()}>
                + Adicionar profissional
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="services" className="space-y-3 max-h-[50vh] overflow-y-auto">
            {services.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2">
                <div className="flex-1">
                  <p className={"text-sm " + (s.active ? "text-neutral-900" : "text-neutral-400 line-through")}>{s.name}</p>
                  <p className="text-xs text-neutral-400">
                    {s.duration_minutes}min{s.price ? ` · R$ ${s.price.toFixed(2)}` : ""}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => toggleService(s)}>
                  {s.active ? "Desativar" : "Reativar"}
                </Button>
              </div>
            ))}
            <div className="space-y-2 rounded-lg border border-dashed border-neutral-300 p-3">
              <Input placeholder="Nome do serviço" value={newServiceName} onChange={(e) => setNewServiceName(e.target.value)} />
              <div className="flex gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Duração (min)</Label>
                  <Input
                    type="number"
                    min={5}
                    step={5}
                    value={newServiceDuration}
                    onChange={(e) => setNewServiceDuration(Number(e.target.value))}
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Preço (opcional)</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="R$"
                    value={newServicePrice}
                    onChange={(e) => setNewServicePrice(e.target.value)}
                  />
                </div>
              </div>
              <Button size="sm" onClick={addService} disabled={!newServiceName.trim()}>
                + Adicionar serviço
              </Button>
            </div>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
