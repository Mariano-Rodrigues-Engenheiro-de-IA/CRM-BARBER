// Aba "Serviços" das configurações - cadastro de serviços, duração,
// preço, profissionais vinculados. Extraído de
// professionals-services-dialog.tsx pra reduzir o tamanho desse arquivo
// (era um dos 3 arquivos gigantes apontados na varredura de código
// morto/arquitetura).

import { useEffect, useState } from "react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/confirm-dialog";
import { toast } from "sonner";

type Api = (path: string, opts?: RequestInit) => Promise<any>;
import { type Professional } from "@/components/professionals-tab";

export type Service = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  duration_minutes: number;
  price: number | null;
  active: boolean;
  professional_ids?: string[];
};

export function ServicesTab({ api, onChanged }: { api: Api; onChanged?: () => void }) {
  const [services, setServices] = useState<Service[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  async function load() {
    const [sr, pr] = await Promise.all([
      api("/api/public/extension/services?include_inactive=1"),
      api("/api/public/extension/professionals"),
    ]);
    if (sr?.ok) setServices(sr.services);
    if (pr?.ok) setProfessionals(pr.professionals);
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

  function professionalNames(ids?: string[]) {
    if (!ids || ids.length === 0) return "Todos os profissionais";
    return (
      ids
        .map((id) => professionals.find((p) => p.id === id)?.name)
        .filter(Boolean)
        .join(", ") || "—"
    );
  }

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
            <div
              key={s.id}
              className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3"
            >
              <div className="min-w-0 flex-1">
                <p
                  className={
                    "truncate text-sm font-medium " +
                    (s.active ? "text-neutral-900" : "text-neutral-400 line-through")
                  }
                >
                  {s.name}
                  {s.category && (
                    <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-500">
                      {s.category}
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-neutral-400">
                  {s.duration_minutes}min{s.price ? ` · R$ ${s.price.toFixed(2)}` : ""}
                  {s.description ? ` · ${s.description}` : ""}
                </p>
                {professionals.length > 0 && (
                  <p className="truncate text-[11px] text-brand">
                    {professionalNames(s.professional_ids)}
                  </p>
                )}
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
        professionals={professionals}
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
  professionals,
  api,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Service | null;
  professionals: Professional[];
  api: Api;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState(30);
  const [price, setPrice] = useState("");
  const [selectedPros, setSelectedPros] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setCategory(editing?.category ?? "");
      setDescription(editing?.description ?? "");
      setDuration(editing?.duration_minutes ?? 30);
      setPrice(editing?.price != null ? String(editing.price) : "");
      setSelectedPros(editing?.professional_ids ?? []);
    }
  }, [open, editing]);

  function toggleProf(id: string) {
    setSelectedPros((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

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
        professional_ids: selectedPros,
      };
      const r = editing
        ? await api(`/api/public/extension/services/${editing.id}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          })
        : await api("/api/public/extension/services", {
            method: "POST",
            body: JSON.stringify(payload),
          });
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
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Corte masculino"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Categoria (opcional)</Label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Ex: Cabelo, Barba, Combo"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Descrição (opcional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Duração (min)</Label>
              <Input
                type="number"
                min={5}
                step={5}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Preço (opcional)</Label>
              <Input
                type="number"
                min={0}
                step={0.01}
                placeholder="R$"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
          </div>
          {professionals.length > 0 && (
            <div className="space-y-1.5">
              <Label>Quem realiza esse serviço</Label>
              <p className="text-xs text-neutral-400">
                Deixe todos desmarcados para liberar pra qualquer profissional.
              </p>
              <div className="flex flex-wrap gap-2">
                {professionals.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleProf(p.id)}
                    className={
                      "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs " +
                      (selectedPros.includes(p.id)
                        ? "border-brand bg-brand/10 text-brand"
                        : "border-neutral-300 text-neutral-600 hover:bg-neutral-50")
                    }
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
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

