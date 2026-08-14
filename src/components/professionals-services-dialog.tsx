import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";

type Api = (path: string, opts?: RequestInit) => Promise<any>;

export type Professional = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  bio: string | null;
  commission_percent: number | null;
  color: string;
  active: boolean;
};
export type Service = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  duration_minutes: number;
  price: number | null;
  active: boolean;
};

const COLORS = ["#7399D7", "#E8998D", "#8FB996", "#D7B26D", "#B589C4", "#6EC4D0"];

/** Aba de Profissionais — cadastro completo (nome, telefone, e-mail, bio,
 * comissão, cor de identificação na agenda). Standalone, reaproveitada
 * tanto na tela de Configurações quanto (via dialog) dentro da Agenda. */
export function ProfessionalsTab({ api, onChanged }: { api: Api; onChanged?: () => void }) {
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  async function load() {
    const r = await api("/api/public/extension/professionals?include_inactive=1");
    if (r?.ok) setProfessionals(r.professionals);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleActive(p: Professional) {
    const r = await api(`/api/public/extension/professionals/${p.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !p.active }),
    });
    if (r?.ok) {
      await load();
      onChanged?.();
    }
  }

  const editing = professionals.find((p) => p.id === editingId) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-700">Profissionais cadastrados</h3>
        <Button
          size="sm"
          onClick={() => {
            setEditingId(null);
            setFormOpen(true);
          }}
        >
          + Novo profissional
        </Button>
      </div>

      {professionals.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-400">
          Nenhum profissional cadastrado ainda.
        </p>
      ) : (
        <div className="space-y-2">
          {professionals.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
              <div className="min-w-0 flex-1">
                <p className={"truncate text-sm font-medium " + (p.active ? "text-neutral-900" : "text-neutral-400 line-through")}>
                  {p.name}
                </p>
                <p className="truncate text-xs text-neutral-400">
                  {[p.phone, p.email].filter(Boolean).join(" · ") || "Sem contato cadastrado"}
                  {p.commission_percent != null ? ` · Comissão ${p.commission_percent}%` : ""}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingId(p.id);
                  setFormOpen(true);
                }}
              >
                Editar
              </Button>
              <Button variant="ghost" size="sm" onClick={() => toggleActive(p)}>
                {p.active ? "Desativar" : "Reativar"}
              </Button>
            </div>
          ))}
        </div>
      )}

      <ProfessionalFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        nextColor={COLORS[professionals.length % COLORS.length]}
        api={api}
        onSaved={async () => {
          await load();
          onChanged?.();
        }}
      />
    </div>
  );
}

function ProfessionalFormDialog({
  open,
  onOpenChange,
  editing,
  nextColor,
  api,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Professional | null;
  nextColor: string;
  api: Api;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [bio, setBio] = useState("");
  const [commission, setCommission] = useState("");
  const [color, setColor] = useState(nextColor);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setPhone(editing?.phone ?? "");
      setEmail(editing?.email ?? "");
      setBio(editing?.bio ?? "");
      setCommission(editing?.commission_percent != null ? String(editing.commission_percent) : "");
      setColor(editing?.color ?? nextColor);
    }
  }, [open, editing, nextColor]);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        bio: bio.trim() || undefined,
        commission_percent: commission ? Number(commission) : undefined,
        color,
      };
      const r = editing
        ? await api(`/api/public/extension/professionals/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await api("/api/public/extension/professionals", { method: "POST", body: JSON.stringify(payload) });
      if (!r?.ok) throw new Error(r?.error || "Erro ao salvar");
      toast.success(editing ? "Profissional atualizado" : "Profissional adicionado");
      onOpenChange(false);
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar profissional" : "Novo profissional"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do profissional" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Telefone (opcional)</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ex: 44991234567" />
            </div>
            <div className="space-y-1.5">
              <Label>E-mail (opcional)</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Bio / especialidades (opcional)</Label>
            <Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={2} placeholder="Ex: especialista em degradê e barba" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Comissão % (opcional)</Label>
              <Input type="number" min={0} max={100} value={commission} onChange={(e) => setCommission(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Cor na agenda</Label>
              <div className="flex gap-1.5 pt-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={"h-7 w-7 rounded-full border-2 " + (color === c ? "border-neutral-900" : "border-transparent")}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? "Salvando..." : editing ? "Salvar" : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Aba de Serviços — cadastro completo (nome, categoria, descrição,
 * duração, preço). */
export function ServicesTab({ api, onChanged }: { api: Api; onChanged?: () => void }) {
  const [services, setServices] = useState<Service[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  async function load() {
    const r = await api("/api/public/extension/services?include_inactive=1");
    if (r?.ok) setServices(r.services);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleActive(s: Service) {
    const r = await api(`/api/public/extension/services/${s.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !s.active }),
    });
    if (r?.ok) {
      await load();
      onChanged?.();
    }
  }

  const editing = services.find((s) => s.id === editingId) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-700">Serviços cadastrados</h3>
        <Button
          size="sm"
          onClick={() => {
            setEditingId(null);
            setFormOpen(true);
          }}
        >
          + Novo serviço
        </Button>
      </div>

      {services.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-400">
          Nenhum serviço cadastrado ainda.
        </p>
      ) : (
        <div className="space-y-2">
          {services.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3">
              <div className="min-w-0 flex-1">
                <p className={"truncate text-sm font-medium " + (s.active ? "text-neutral-900" : "text-neutral-400 line-through")}>
                  {s.name}
                  {s.category && <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-500">{s.category}</span>}
                </p>
                <p className="truncate text-xs text-neutral-400">
                  {s.duration_minutes}min{s.price ? ` · R$ ${s.price.toFixed(2)}` : ""}
                  {s.description ? ` · ${s.description}` : ""}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingId(s.id);
                  setFormOpen(true);
                }}
              >
                Editar
              </Button>
              <Button variant="ghost" size="sm" onClick={() => toggleActive(s)}>
                {s.active ? "Desativar" : "Reativar"}
              </Button>
            </div>
          ))}
        </div>
      )}

      <ServiceFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        api={api}
        onSaved={async () => {
          await load();
          onChanged?.();
        }}
      />
    </div>
  );
}

function ServiceFormDialog({
  open,
  onOpenChange,
  editing,
  api,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Service | null;
  api: Api;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState(30);
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setCategory(editing?.category ?? "");
      setDescription(editing?.description ?? "");
      setDuration(editing?.duration_minutes ?? 30);
      setPrice(editing?.price != null ? String(editing.price) : "");
    }
  }, [open, editing]);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        category: category.trim() || undefined,
        description: description.trim() || undefined,
        duration_minutes: duration,
        price: price ? Number(price) : undefined,
      };
      const r = editing
        ? await api(`/api/public/extension/services/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await api("/api/public/extension/services", { method: "POST", body: JSON.stringify(payload) });
      if (!r?.ok) throw new Error(r?.error || "Erro ao salvar");
      toast.success(editing ? "Serviço atualizado" : "Serviço adicionado");
      onOpenChange(false);
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar serviço" : "Novo serviço"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nome do serviço</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Corte masculino" />
          </div>
          <div className="space-y-1.5">
            <Label>Categoria (opcional)</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Ex: Cabelo, Barba, Combo" />
          </div>
          <div className="space-y-1.5">
            <Label>Descrição (opcional)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Duração (min)</Label>
              <Input type="number" min={5} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>Preço (opcional)</Label>
              <Input type="number" min={0} step={0.01} placeholder="R$" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? "Salvando..." : editing ? "Salvar" : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Dialog com as duas abas juntas — atalho rápido a partir da Agenda. */
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
          <TabsContent value="professionals" className="max-h-[50vh] overflow-y-auto">
            <ProfessionalsTab api={api} onChanged={onChanged} />
          </TabsContent>
          <TabsContent value="services" className="max-h-[50vh] overflow-y-auto">
            <ServicesTab api={api} onChanged={onChanged} />
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
