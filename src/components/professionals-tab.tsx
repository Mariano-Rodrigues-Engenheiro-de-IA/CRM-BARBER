// Aba "Profissionais" das configurações - cadastro, cores, comissão,
// avatar. Extraído de professionals-services-dialog.tsx pra reduzir o
// tamanho desse arquivo (era um dos 3 arquivos gigantes apontados na
// varredura de código morto/arquitetura).

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

export type Professional = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  bio: string | null;
  commission_percent: number | null;
  color: string;
  avatar_url: string | null;
  active: boolean;
  appointment_count?: number;
};

async function fileToSquareDataUrl(file: File, size = 160): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não consegui processar a imagem");
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );
  return canvas.toDataURL("image/jpeg", 0.82);
}

/** Bolinha do profissional: foto quando existe, senão a cor de identificação. */
export function ProfessionalAvatar({
  professional,
  size = 24,
}: {
  professional: { name: string; color: string; avatar_url?: string | null };
  size?: number;
}) {
  if (professional.avatar_url) {
    return (
      <img
        src={professional.avatar_url}
        alt={`Foto de ${professional.name}`}
        className="shrink-0 rounded-full object-cover"
        style={{
          width: size,
          height: size,
          borderColor: professional.color,
          borderWidth: 2,
          borderStyle: "solid",
        }}
      />
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
      style={{ width: size, height: size, backgroundColor: professional.color }}
    >
      {professional.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

const COLORS = ["#7399D7", "#E8998D", "#8FB996", "#D7B26D", "#B589C4", "#6EC4D0"];

/** Aba de Profissionais — cadastro completo (nome, telefone, e-mail, bio,
 * comissão, cor de identificação na agenda). Standalone, reaproveitada
 * tanto na tela de Configurações quanto (via dialog) dentro da Agenda. */
export function ProfessionalsTab({ api, onChanged }: { api: Api; onChanged?: () => void }) {
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

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

  async function deleteProfessional(p: Professional) {
    const hasHistory = (p.appointment_count ?? 0) > 0;
    const ok = await confirm(
      hasHistory
        ? {
            title: "Este profissional possui agendamentos vinculados.",
            description: `Ao excluir ${p.name}, os ${p.appointment_count} agendamento${p.appointment_count === 1 ? "" : "s"} vinculados a ele também serão excluídos. Tem certeza de que deseja continuar?`,
            confirmLabel: "Excluir profissional",
            destructive: true,
          }
        : {
            title: `Tem certeza que deseja excluir ${p.name}?`,
            confirmLabel: "Excluir",
            destructive: true,
          },
    );
    if (!ok) return;
    const r = await api(`/api/public/extension/professionals/${p.id}`, { method: "DELETE" });
    if (!r?.ok) {
      toast.error(r?.error || "Erro ao excluir");
      return;
    }
    toast.success("Profissional excluído");
    await load();
    onChanged?.();
  }

  const editing = professionals.find((p) => p.id === editingId) ?? null;

  return (
    <div className="space-y-3">
      {confirmDialog}
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
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3"
            >
              <ProfessionalAvatar professional={p} size={32} />
              <div className="min-w-0 flex-1">
                <p
                  className={
                    "truncate text-sm font-medium " +
                    (p.active ? "text-neutral-900" : "text-neutral-400 line-through")
                  }
                >
                  {p.name}
                </p>
                <p className="truncate text-xs text-neutral-400">
                  {[p.phone, p.email].filter(Boolean).join(" · ") || "Sem contato cadastrado"}
                  {p.commission_percent != null ? ` · Comissão ${p.commission_percent}%` : ""}
                </p>
                {p.bio && <p className="truncate text-[11px] text-brand">{p.bio}</p>}
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
              <Button
                variant="ghost"
                size="sm"
                className="text-neutral-400 hover:bg-red-50 hover:text-red-600"
                onClick={() => void deleteProfessional(p)}
                title="Excluir"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 6h18" />
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
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
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setPhone(editing?.phone ?? "");
      setEmail(editing?.email ?? "");
      setBio(editing?.bio ?? "");
      setCommission(editing?.commission_percent != null ? String(editing.commission_percent) : "");
      setColor(editing?.color ?? nextColor);
      setAvatarUrl(editing?.avatar_url ?? null);
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
        avatar_url: avatarUrl,
      };
      const r = editing
        ? await api(`/api/public/extension/professionals/${editing.id}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          })
        : await api("/api/public/extension/professionals", {
            method: "POST",
            body: JSON.stringify(payload),
          });
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
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome do profissional"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Telefone (opcional)</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Ex: 44991234567"
              />
            </div>
            <div className="space-y-1.5">
              <Label>E-mail (opcional)</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Foto (opcional)</Label>
            <div className="flex items-center gap-3">
              <ProfessionalAvatar
                professional={{ name: name || "?", color, avatar_url: avatarUrl }}
                size={56}
              />
              <div className="flex gap-2">
                <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-600 hover:border-brand">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        setAvatarUrl(await fileToSquareDataUrl(file));
                      } catch {
                        toast.error("Não consegui usar essa imagem.");
                      }
                    }}
                  />
                  {avatarUrl ? "Trocar foto" : "Escolher foto"}
                </label>
                {avatarUrl && (
                  <Button variant="outline" size="sm" onClick={() => setAvatarUrl(null)}>
                    Remover
                  </Button>
                )}
              </div>
            </div>
            <p className="text-[11px] text-neutral-400">
              A foto aparece na agenda no lugar da bolinha colorida.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Especialidades (opcional)</Label>
            <Textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={2}
              placeholder="Ex: especialista em degradê e barba"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Comissão % (opcional)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={commission}
                onChange={(e) => setCommission(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Cor na agenda</Label>
              <div className="flex gap-1.5 pt-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={
                      "h-7 w-7 rounded-full border-2 " +
                      (color === c ? "border-neutral-900" : "border-transparent")
                    }
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
