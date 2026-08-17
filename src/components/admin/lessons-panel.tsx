// Painel de Aulas (academy) — criar, editar, reordenar, marcar destaque,
// ativar/desativar. Extraído de admin.lessons.tsx para ser reaproveitado
// dentro do painel admin unificado (com abas).

import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  adminListLessons,
  adminCreateLesson,
  adminUpdateLesson,
  adminDeleteLesson,
  type LessonRow,
} from "@/lib/admin-lessons.functions";
import { youtubeThumbnail } from "@/lib/youtube";

export function AdminLessonsPanel() {
  const listLessons = useServerFn(adminListLessons);
  const createLesson = useServerFn(adminCreateLesson);
  const updateLesson = useServerFn(adminUpdateLesson);
  const deleteLesson = useServerFn(adminDeleteLesson);

  const [lessons, setLessons] = useState<LessonRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);

  async function reload() {
    try {
      const data = await listLessons();
      setLessons(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleToggleActive(l: LessonRow) {
    await updateLesson({ data: { id: l.id, active: !l.active } });
    await reload();
  }

  async function handleDelete(l: LessonRow) {
    if (!confirm(`Remover a aula "${l.title}"?`)) return;
    await deleteLesson({ data: { id: l.id } });
    await reload();
  }

  const editing = editingId && editingId !== "new" ? lessons?.find((l) => l.id === editingId) ?? null : null;

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-neutral-900">Aulas</h1>
            <p className="text-sm text-neutral-500">Conteúdo da área de treinamento — visível pra todos os clientes.</p>
          </div>
          <button
            onClick={() => setEditingId("new")}
            className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong"
          >
            + Nova aula
          </button>
        </div>

        {error && <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

        <div className="space-y-2">
          {!lessons ? (
            <p className="text-sm text-neutral-500">Carregando...</p>
          ) : lessons.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-400">
              Nenhuma aula cadastrada ainda.
            </p>
          ) : (
            lessons.map((l) => {
              const thumb = youtubeThumbnail(l.youtube_url);
              return (
                <div key={l.id} className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3">
                  {thumb ? (
                    <img src={thumb} alt="" className="h-14 w-24 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <div className="h-14 w-24 shrink-0 rounded-lg bg-neutral-100" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={"truncate text-sm font-medium " + (l.active ? "text-neutral-900" : "text-neutral-400 line-through")}>
                      {l.title}
                      {l.featured && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                          Destaque
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-neutral-400">{l.youtube_url}</p>
                  </div>
                  <button onClick={() => setEditingId(l.id)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100">
                    Editar
                  </button>
                  <button onClick={() => handleToggleActive(l)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100">
                    {l.active ? "Desativar" : "Reativar"}
                  </button>
                  <button onClick={() => handleDelete(l)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
                    Remover
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {editingId && (
        <LessonFormModal
          editing={editing}
          onClose={() => setEditingId(null)}
          onSaved={async () => {
            setEditingId(null);
            await reload();
          }}
          createLesson={createLesson}
          updateLesson={updateLesson}
        />
      )}
    </>
  );
}

function LessonFormModal({
  editing,
  onClose,
  onSaved,
  createLesson,
  updateLesson,
}: {
  editing: LessonRow | null;
  onClose: () => void;
  onSaved: () => void;
  createLesson: ReturnType<typeof useServerFn<typeof adminCreateLesson>>;
  updateLesson: ReturnType<typeof useServerFn<typeof adminUpdateLesson>>;
}) {
  const [title, setTitle] = useState(editing?.title ?? "");
  const [youtubeUrl, setYoutubeUrl] = useState(editing?.youtube_url ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [featured, setFeatured] = useState(editing?.featured ?? false);
  const [sortOrder, setSortOrder] = useState(editing?.sort_order ?? 0);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSave() {
    if (!title.trim() || !youtubeUrl.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      if (editing) {
        await updateLesson({
          data: { id: editing.id, title: title.trim(), youtube_url: youtubeUrl.trim(), description: description.trim() || null, featured, sort_order: sortOrder },
        });
      } else {
        await createLesson({
          data: { title: title.trim(), youtube_url: youtubeUrl.trim(), description: description.trim() || undefined, featured, sort_order: sortOrder },
        });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6">
        <h2 className="text-lg font-bold text-neutral-900">{editing ? "Editar aula" : "Nova aula"}</h2>
        {err && <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700">{err}</div>}
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-neutral-600">Título</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Como conectar seu WhatsApp"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-neutral-600">Link do YouTube</label>
            <input
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-neutral-600">Descrição (opcional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium text-neutral-600">Ordem</label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand"
              />
            </div>
            <label className="flex items-center gap-2 pt-4 text-sm text-neutral-700">
              <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
              Aula em destaque (banner grande)
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-600">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={!title.trim() || !youtubeUrl.trim() || saving}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
