// Painel de Campanhas (catálogo do marketplace sazonal) — criar,
// editar, reordenar, ativar/desativar. Cada campanha pertence a um mês
// (ou fica "atemporal", sem mês fixo).

import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  adminListCampaigns,
  adminCreateCampaign,
  adminUpdateCampaign,
  adminDeleteCampaign,
  adminUploadCampaignCover,
  type CampaignCatalogRow,
} from "@/lib/admin-campaigns.functions";
import { useCachedFetch } from "@/lib/api-cache";

const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export function AdminCampaignsPanel() {
  const listCampaigns = useServerFn(adminListCampaigns);
  const createCampaign = useServerFn(adminCreateCampaign);
  const updateCampaign = useServerFn(adminUpdateCampaign);
  const deleteCampaign = useServerFn(adminDeleteCampaign);

  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const { data: campaigns, refetch: reload } = useCachedFetch<CampaignCatalogRow[]>(
    "admin-campaigns",
    async () => {
      try {
        return await listCampaigns();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return [];
      }
    },
  );

  async function handleToggleActive(c: CampaignCatalogRow) {
    await updateCampaign({ data: { id: c.id, active: !c.active } });
    await reload();
  }

  async function handleDelete(c: CampaignCatalogRow) {
    if (!confirm(`Remover a campanha "${c.title}"?`)) return;
    await deleteCampaign({ data: { id: c.id } });
    await reload();
  }

  const editing =
    editingId && editingId !== "new" ? (campaigns?.find((c) => c.id === editingId) ?? null) : null;

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-neutral-900">Campanhas</h1>
            <p className="text-sm text-neutral-500">
              Catálogo do calendário de campanhas — visível pra todos os clientes na aba Campanhas.
            </p>
          </div>
          <button
            onClick={() => setEditingId("new")}
            className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong"
          >
            + Nova campanha
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="space-y-2">
          {!campaigns ? (
            <p className="text-sm text-neutral-500">Carregando...</p>
          ) : campaigns.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-400">
              Nenhuma campanha cadastrada ainda.
            </p>
          ) : (
            campaigns.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3"
              >
                {c.cover_image_url ? (
                  <img
                    src={c.cover_image_url}
                    alt=""
                    className="h-14 w-24 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div className="h-14 w-24 shrink-0 rounded-lg bg-neutral-100" />
                )}
                <div className="min-w-0 flex-1">
                  <p
                    className={
                      "truncate text-sm font-medium " +
                      (c.active ? "text-neutral-900" : "text-neutral-400 line-through")
                    }
                  >
                    {c.title}
                    {c.theme && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                        {c.theme}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-neutral-400">
                    {c.month ? MONTH_NAMES[c.month - 1] : "Sem mês fixo"} · {c.idea_summary}
                  </p>
                </div>
                <button
                  onClick={() => setEditingId(c.id)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
                >
                  Editar
                </button>
                <button
                  onClick={() => handleToggleActive(c)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
                >
                  {c.active ? "Desativar" : "Reativar"}
                </button>
                <button
                  onClick={() => handleDelete(c)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  Remover
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {editingId && (
        <CampaignFormModal
          editing={editing}
          onClose={() => setEditingId(null)}
          onSaved={async () => {
            setEditingId(null);
            await reload();
          }}
          createCampaign={createCampaign}
          updateCampaign={updateCampaign}
        />
      )}
    </>
  );
}

function CampaignFormModal({
  editing,
  onClose,
  onSaved,
  createCampaign,
  updateCampaign,
}: {
  editing: CampaignCatalogRow | null;
  onClose: () => void;
  onSaved: () => void;
  createCampaign: ReturnType<typeof useServerFn<typeof adminCreateCampaign>>;
  updateCampaign: ReturnType<typeof useServerFn<typeof adminUpdateCampaign>>;
}) {
  const uploadCover = useServerFn(adminUploadCampaignCover);
  const [title, setTitle] = useState(editing?.title ?? "");
  const [month, setMonth] = useState<number | "">(editing?.month ?? "");
  const [theme, setTheme] = useState(editing?.theme ?? "");
  const [ideaSummary, setIdeaSummary] = useState(editing?.idea_summary ?? "");
  const [suggestedCopy, setSuggestedCopy] = useState(editing?.suggested_copy ?? "");
  const [coverImageUrl, setCoverImageUrl] = useState(editing?.cover_image_url ?? "");
  const [uploading, setUploading] = useState(false);
  const [sortOrder, setSortOrder] = useState(editing?.sort_order ?? 0);
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
      const result = await uploadCover({
        data: { fileName: file.name, contentType: file.type, base64 },
      });
      setCoverImageUrl(result.url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao enviar a imagem");
    } finally {
      setUploading(false);
    }
  }

  const valid = title.trim() && ideaSummary.trim() && suggestedCopy.trim();

  async function handleSave() {
    if (!valid) return;
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        title: title.trim(),
        month: month === "" ? null : month,
        theme: theme.trim() || undefined,
        idea_summary: ideaSummary.trim(),
        suggested_copy: suggestedCopy.trim(),
        cover_image_url: coverImageUrl.trim() || undefined,
        sort_order: sortOrder,
      };
      if (editing) {
        await updateCampaign({ data: { id: editing.id, ...payload } });
      } else {
        await createCampaign({ data: payload });
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
      <div className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-6">
        <h2 className="text-lg font-bold text-neutral-900">
          {editing ? "Editar campanha" : "Nova campanha"}
        </h2>
        {err && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700">
            {err}
          </div>
        )}
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-neutral-600">Título</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Black Friday — assinatura com desconto"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium text-neutral-600">Mês</label>
              <select
                value={month}
                onChange={(e) => setMonth(e.target.value ? Number(e.target.value) : "")}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand"
              >
                <option value="">Sem mês fixo</option>
                {MONTH_NAMES.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium text-neutral-600">Tema (selo, opcional)</label>
              <input
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                placeholder="Ex: Black Friday"
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-neutral-600">Ideia geral da campanha</label>
            <textarea
              value={ideaSummary}
              onChange={(e) => setIdeaSummary(e.target.value)}
              rows={2}
              placeholder="Explica o porquê da campanha, pro dono entender antes de usar a copy pronta"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-neutral-600">
              Copy pronta (texto sugerido)
            </label>
            <textarea
              value={suggestedCopy}
              onChange={(e) => setSuggestedCopy(e.target.value)}
              rows={4}
              placeholder="O texto que o dono vai usar/editar pra disparar"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-neutral-600">
              Imagem de capa (opcional)
            </label>
            <div className="flex items-start gap-3">
              <div className="h-20 w-32 shrink-0 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100">
                {coverImageUrl && (
                  <img src={coverImageUrl} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="space-y-1.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                >
                  {uploading ? "Enviando..." : coverImageUrl ? "Trocar imagem" : "Enviar imagem"}
                </button>
                <p className="text-[11px] text-neutral-400">
                  Formato paisagem funciona melhor pra capa de card.
                </p>
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-neutral-600">Ordem</label>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-600"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={!valid || saving}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
