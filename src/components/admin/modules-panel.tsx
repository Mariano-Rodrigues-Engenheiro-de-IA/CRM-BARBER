// Painel de Módulos de Treinamento — criar, editar, reordenar,
// ativar/desativar, com upload real de capa (formato retrato 500x750,
// estilo capa de curso).

import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  adminListModules,
  adminCreateModule,
  adminUpdateModule,
  adminDeleteModule,
  adminUploadModuleCover,
  type ModuleRow,
} from "@/lib/admin-modules.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export function AdminModulesPanel() {
  const listModules = useServerFn(adminListModules);
  const deleteModule = useServerFn(adminDeleteModule);
  const updateModule = useServerFn(adminUpdateModule);

  const [modules, setModules] = useState<ModuleRow[] | null>(null);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);

  async function reload() {
    const data = await listModules();
    setModules(data);
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleToggleActive(m: ModuleRow) {
    await updateModule({ data: { id: m.id, active: !m.active } });
    await reload();
  }

  async function handleToggleLocked(m: ModuleRow) {
    await updateModule({ data: { id: m.id, locked: !m.locked } });
    await reload();
  }

  async function handleDelete(m: ModuleRow) {
    if (!confirm(`Remover o módulo "${m.title}"? As aulas dele ficam sem módulo.`)) return;
    await deleteModule({ data: { id: m.id } });
    await reload();
  }

  const editing = editingId && editingId !== "new" ? modules?.find((m) => m.id === editingId) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Módulos de Treinamento</h1>
          <p className="text-sm text-neutral-500">Organiza as aulas em módulos (Tráfego Pago, Vendas, Agente de IA...).</p>
        </div>
        <Button onClick={() => setEditingId("new")}>+ Novo módulo</Button>
      </div>

      {!modules ? (
        <p className="text-sm text-neutral-500">Carregando...</p>
      ) : modules.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-400">
          Nenhum módulo cadastrado ainda.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {modules.map((m) => (
            <div key={m.id} className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
              <div className="relative aspect-[2/3] w-full bg-neutral-100">
                {m.cover_image_url ? (
                  <img
                    src={m.cover_image_url}
                    alt={m.title}
                    className={"h-full w-full object-cover " + (m.locked ? "opacity-40 grayscale" : "")}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-neutral-400">Sem capa</div>
                )}
                {m.locked && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <LockIcon />
                  </div>
                )}
              </div>
              <div className="p-2.5">
                <p className={"truncate text-sm font-medium " + (m.active ? "text-neutral-900" : "text-neutral-400 line-through")}>
                  {m.title}
                </p>
                <div className="mt-2 flex gap-1">
                  <Button variant="ghost" size="sm" className="h-7 flex-1 px-2 text-xs" onClick={() => setEditingId(m.id)}>
                    Editar
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => handleToggleActive(m)}>
                    {m.active ? "Ocultar" : "Ativar"}
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className={"h-7 w-full px-2 text-xs " + (m.locked ? "text-amber-600" : "text-neutral-500")}
                  onClick={() => handleToggleLocked(m)}
                >
                  {m.locked ? "🔒 Trancado — liberar" : "🔓 Liberado — trancar"}
                </Button>
                <Button variant="ghost" size="sm" className="h-7 w-full px-2 text-xs text-red-600" onClick={() => handleDelete(m)}>
                  Remover
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editingId && (
        <ModuleFormModal
          editing={editing}
          onClose={() => setEditingId(null)}
          onSaved={async () => {
            setEditingId(null);
            await reload();
          }}
        />
      )}
    </div>
  );
}

function ModuleFormModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: ModuleRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const createModule = useServerFn(adminCreateModule);
  const updateModule = useServerFn(adminUpdateModule);
  const uploadCover = useServerFn(adminUploadModuleCover);

  const [title, setTitle] = useState(editing?.title ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [sortOrder, setSortOrder] = useState(editing?.sort_order ?? 0);
  const [coverUrl, setCoverUrl] = useState(editing?.cover_image_url ?? "");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setErr(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const result = await uploadCover({ data: { fileName: file.name, contentType: file.type, base64 } });
      setCoverUrl(result.url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao enviar a imagem");
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        cover_image_url: coverUrl || undefined,
        sort_order: sortOrder,
      };
      if (editing) {
        await updateModule({ data: { id: editing.id, ...payload } });
      } else {
        await createModule({ data: payload });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar módulo" : "Novo módulo"}</DialogTitle>
        </DialogHeader>
        {err && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700">{err}</p>}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Capa (retrato, ideal 500×750px)</Label>
            <div className="flex items-start gap-3">
              <div className="h-28 w-[75px] shrink-0 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100">
                {coverUrl && <img src={coverUrl} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="space-y-1.5">
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                  {uploading ? "Enviando..." : coverUrl ? "Trocar imagem" : "Enviar imagem"}
                </Button>
                <p className="text-[11px] text-neutral-400">Formato retrato, tipo capa de curso — ideal 500×750px (proporção 2:3).</p>
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Título</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Tráfego Pago" />
          </div>
          <div className="space-y-1.5">
            <Label>Descrição (opcional)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label>Ordem</Label>
            <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!title.trim() || saving || uploading}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LockIcon() {
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
    </div>
  );
}
