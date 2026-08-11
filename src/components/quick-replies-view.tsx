// Respostas rápidas — criação e gestão no painel do CRM.
//
// Cada resposta rápida tem título + lista ordenada de ações
// (texto, imagem, vídeo, áudio). A mesma lista é consumida pela extensão
// dentro do WhatsApp Web para enviar tudo em sequência.

import { useEffect, useRef, useState } from "react";
import type { Funnel } from "@/lib/funnels";
import {
  actionLabel,
  QUICK_REPLY_ACTION_TYPES,
  QUICK_REPLY_FUNNEL_TYPES,
  type QuickReply,
  type QuickReplyAction,
  type QuickReplyActionType,
} from "@/lib/quick-replies";

type ApiFn = (path: string, opts?: RequestInit) => Promise<Record<string, unknown>>;

const inputCls =
  "w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });
}

// Alguns sistemas (principalmente macOS) não casam `video/*` e `audio/*` com
// extensões comuns, então listamos as extensões junto do mime.
function acceptFor(type: QuickReplyActionType) {
  if (type === "image") return "image/*,.jpg,.jpeg,.png,.webp,.gif";
  if (type === "video") return "video/*,.mp4,.mov,.m4v,.3gp,.webm,.avi,.mkv";
  return "audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.amr,.caf";
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  mp4: "video/mp4", mov: "video/quicktime", m4v: "video/x-m4v", "3gp": "video/3gpp",
  webm: "video/webm", avi: "video/x-msvideo", mkv: "video/x-matroska",
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg",
  opus: "audio/ogg", wav: "audio/wav", amr: "audio/amr", caf: "audio/x-caf",
};

/** O navegador às vezes entrega file.type vazio; deduz pelo sufixo do arquivo. */
function resolveMime(file: File, type: QuickReplyActionType) {
  if (file.type && /^(image|video|audio)\//.test(file.type)) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  return MIME_BY_EXT[ext] || `${type}/octet-stream`;
}

/** Cache entre navegações: reabrir a aba não deve piscar "Carregando...". */
let repliesCache: QuickReply[] | null = null;

export function QuickRepliesView({ token, api }: { token: string; api: ApiFn }) {
  const [replies, setReplies] = useState<QuickReply[]>(() => repliesCache ?? []);
  const [loading, setLoading] = useState(repliesCache === null);
  const [editing, setEditing] = useState<QuickReply | "new" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    const r = await api("/api/public/extension/quick-replies");
    if (r?.ok) {
      const list = (r.quick_replies as QuickReply[]) || [];
      repliesCache = list;
      setReplies(list);
      setErr(null);
    } else setErr((r?.error as string) || "Erro ao carregar respostas rápidas");
    setLoading(false);
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);


  async function remove(id: string) {
    await api(`/api/public/extension/quick-replies/${id}`, { method: "DELETE" });
    void reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-neutral-900">Respostas rápidas</h2>
        <button
          onClick={() => setEditing("new")}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong"
        >
          + Nova resposta
        </button>
      </div>

      {err && <p className="text-sm text-red-500">{err}</p>}
      {loading && <p className="text-sm text-neutral-500">Carregando...</p>}

      <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-300 bg-white">
        {replies.map((qr) => (
          <div key={qr.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0 truncate text-sm font-medium text-neutral-900">{qr.title}</span>
            <div className="flex shrink-0 gap-1">
              <button
                onClick={() => setEditing(qr)}
                className="rounded px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
              >
                Editar
              </button>
              <button
                onClick={() => remove(qr.id)}
                className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
              >
                Excluir
              </button>
            </div>
          </div>
        ))}
        {!loading && replies.length === 0 && (
          <p className="px-4 py-3 text-sm text-neutral-500">Nenhuma resposta rápida criada ainda.</p>
        )}
      </div>


      {editing && (
        <QuickReplyEditor
          api={api}
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

function QuickReplyEditor({
  api,
  initial,
  onClose,
  onSaved,
}: {
  api: ApiFn;
  initial: QuickReply | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [actions, setActions] = useState<QuickReplyAction[]>(initial?.actions ?? [{ type: "text", text: "" }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const uploadIndex = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [funnels, setFunnels] = useState<Funnel[]>([]);

  useEffect(() => {
    api("/api/public/extension/funnels").then((r) => {
      if (r?.ok) setFunnels((r.funnels as Funnel[]) || []);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(i: number, patch: Partial<QuickReplyAction>) {
    setActions((list) => list.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }
  function addAction(type: QuickReplyActionType) {
    setActions((list) => [...list, type === "text" ? { type, text: "" } : { type }]);
  }
  function removeAction(i: number) {
    setActions((list) => list.filter((_, idx) => idx !== i));
  }
  function move(i: number, dir: -1 | 1) {
    setActions((list) => {
      const next = [...list];
      const j = i + dir;
      if (j < 0 || j >= next.length) return list;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function onPickFile(file: File) {
    const i = uploadIndex.current;
    if (i === null) return;
    setBusy(true);
    setErr(null);
    try {
      const mime = resolveMime(file, actions[i]?.type ?? "image");
      if (!/^(image|video|audio)\//.test(mime)) {
        throw new Error("Formato não suportado. Use imagem, vídeo ou áudio.");
      }
      const dataUrl = await fileToBase64(file);
      const r = await api("/api/public/extension/quick-replies/upload", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, mime, data_base64: dataUrl }),
      });
      if (!r?.ok) throw new Error((r?.error as string) || "Falha no upload");
      update(i, {
        path: r.path as string,
        url: r.url as string,
        mime: r.mime as string,
        filename: r.filename as string,
      });
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
      uploadIndex.current = null;
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function save() {
    const clean = actions
      .map((a) => (a.type === "text" ? { type: a.type, text: (a.text || "").trim() } : a))
      .filter((a) =>
        a.type === "text"
          ? !!a.text
          : a.type === "funnel_add"
            ? !!a.funnel_id && !!a.stage_id
            : a.type === "funnel_remove"
              ? !!a.funnel_id
              : !!a.path,
      );
    if (!title.trim() || clean.length === 0) {
      setErr("Informe um título e pelo menos uma ação preenchida.");
      return;
    }
    setBusy(true);
    setErr(null);
    const body = JSON.stringify({ title: title.trim(), actions: clean });
    const r = initial
      ? await api(`/api/public/extension/quick-replies/${initial.id}`, { method: "PATCH", body })
      : await api("/api/public/extension/quick-replies", { method: "POST", body });
    setBusy(false);
    if (!r?.ok) {
      setErr((r?.error as string) || "Erro ao salvar");
      return;
    }
    onSaved();
  }

  

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="mt-10 w-full max-w-2xl rounded-xl border border-neutral-300 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-neutral-900">
            {initial ? "Editar resposta rápida" : "Nova resposta rápida"}
          </h3>
          <button onClick={onClose} className="rounded p-1 text-neutral-400 hover:text-neutral-900">
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-600">Título</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Cobrança mensalidade"
              className={inputCls}
            />
          </div>

          <div className="space-y-3">
            {actions.map((a, i) => (
              <div key={i} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded bg-yellow-100 px-2 py-0.5 text-[11px] font-semibold text-yellow-800">
                    {i + 1}. {actionLabel(a.type)}
                  </span>
                  <div className="flex gap-1 text-xs">
                    <button onClick={() => move(i, -1)} className="rounded px-2 py-1 hover:bg-neutral-200">↑</button>
                    <button onClick={() => move(i, 1)} className="rounded px-2 py-1 hover:bg-neutral-200">↓</button>
                    <button onClick={() => removeAction(i)} className="rounded px-2 py-1 text-red-600 hover:bg-red-50">
                      remover
                    </button>
                  </div>
                </div>

                {a.type === "funnel_add" || a.type === "funnel_remove" ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <select
                      value={a.funnel_id ?? ""}
                      onChange={(e) => update(i, { funnel_id: e.target.value || undefined, stage_id: undefined })}
                      className={inputCls + " max-w-[220px]"}
                    >
                      <option value="">Escolha o funil</option>
                      {funnels.map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                    {a.type === "funnel_add" && (
                      <select
                        value={a.stage_id ?? ""}
                        onChange={(e) => update(i, { stage_id: e.target.value || undefined })}
                        className={inputCls + " max-w-[220px]"}
                      >
                        <option value="">Escolha a etapa</option>
                        {(funnels.find((f) => f.id === a.funnel_id)?.stages ?? []).map((st) => (
                          <option key={st.id} value={st.id}>{st.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                ) : a.type === "text" ? (
                  <textarea
                    value={a.text ?? ""}
                    onChange={(e) => update(i, { text: e.target.value })}
                    rows={3}
                    placeholder="Oi {nome}, tudo certo?"
                    className={inputCls + " mt-2"}
                  />
                ) : (
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          uploadIndex.current = i;
                          if (fileInput.current) fileInput.current.accept = acceptFor(a.type);
                          fileInput.current?.click();
                        }}
                        disabled={busy}
                        className="rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 disabled:opacity-50"
                      >
                        {a.path ? "Trocar arquivo" : "Escolher arquivo"}
                      </button>
                      {a.path && (
                        <span className="max-w-[160px] truncate text-xs text-neutral-500" title={a.filename ?? ""}>
                          {a.filename}
                        </span>
                      )}
                    </div>
                    <input
                      value={a.caption ?? ""}
                      onChange={(e) => update(i, { caption: e.target.value })}
                      placeholder="Legenda (opcional)"
                      className={inputCls}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          <input
            ref={fileInput}
            type="file"
            accept="image/*,video/*,audio/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPickFile(f);
            }}
          />

          <div className="flex flex-wrap gap-2">
            {[...QUICK_REPLY_ACTION_TYPES, ...QUICK_REPLY_FUNNEL_TYPES].map((t) => (
              <button
                key={t}
                onClick={() => addAction(t)}
                className="rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-100"
              >
                + {actionLabel(t)}
              </button>
            ))}
          </div>

          {err && <p className="text-sm text-red-500">{err}</p>}

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm">
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
            >
              {busy ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
