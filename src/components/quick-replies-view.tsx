// Respostas rápidas — criação e gestão no painel do CRM.
//
// Cada resposta rápida tem título + lista ordenada de ações
// (texto, imagem, vídeo, áudio). A mesma lista é consumida pela extensão
// dentro do WhatsApp Web para enviar tudo em sequência.

import { useEffect, useRef, useState } from "react";
import {
  actionLabel,
  QUICK_REPLY_ACTION_TYPES,
  type QuickReply,
  type QuickReplyAction,
  type QuickReplyActionType,
} from "@/lib/quick-replies";

type ApiFn = (path: string, opts?: RequestInit) => Promise<Record<string, unknown>>;

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });
}

function acceptFor(type: QuickReplyActionType) {
  return type === "image" ? "image/*" : type === "video" ? "video/*" : "audio/*";
}

export function QuickRepliesView({ token, api }: { token: string; api: ApiFn }) {
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<QuickReply | "new" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    const r = await api("/api/public/extension/quick-replies");
    if (r?.ok) setReplies((r.quick_replies as QuickReply[]) || []);
    else setErr((r?.error as string) || "Erro ao carregar respostas rápidas");
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
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">Respostas rápidas</h2>
          <p className="text-sm text-neutral-500">
            Monte mensagens prontas (texto, imagem, vídeo, áudio) e envie em um clique
            dentro do WhatsApp ou pelo card do assinante.
          </p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-yellow-400 hover:bg-neutral-800"
        >
          + Nova resposta
        </button>
      </div>

      {err && <p className="text-sm text-red-500">{err}</p>}
      {loading && <p className="text-sm text-neutral-500">Carregando...</p>}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {replies.map((qr) => (
          <div key={qr.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold text-neutral-900">{qr.title}</h3>
              <div className="flex gap-1">
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
            <ol className="mt-3 space-y-1 text-xs text-neutral-600">
              {qr.actions.map((a, i) => (
                <li key={i} className="flex gap-2">
                  <span className="rounded bg-yellow-100 px-1.5 py-0.5 font-medium text-yellow-800">
                    {actionLabel(a.type)}
                  </span>
                  <span className="truncate">{a.type === "text" ? a.text : a.filename || a.caption || "arquivo"}</span>
                </li>
              ))}
            </ol>
          </div>
        ))}
        {!loading && replies.length === 0 && (
          <p className="text-sm text-neutral-500">Nenhuma resposta rápida criada ainda.</p>
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
      const dataUrl = await fileToBase64(file);
      const r = await api("/api/public/extension/quick-replies/upload", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, mime: file.type, data_base64: dataUrl }),
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
      .filter((a) => (a.type === "text" ? !!a.text : !!a.path));
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

  const currentType = uploadIndex.current !== null ? actions[uploadIndex.current]?.type : "image";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="mt-10 w-full max-w-2xl rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl">
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

                {a.type === "text" ? (
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
                          fileInput.current?.click();
                        }}
                        disabled={busy}
                        className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 disabled:opacity-50"
                      >
                        {a.path ? "Trocar arquivo" : "Escolher arquivo"}
                      </button>
                      <span className="truncate text-xs text-neutral-500">{a.filename || "nenhum arquivo"}</span>
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
            accept={acceptFor((currentType as QuickReplyActionType) || "image")}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPickFile(f);
            }}
          />

          <div className="flex flex-wrap gap-2">
            {QUICK_REPLY_ACTION_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => addAction(t)}
                className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-100"
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
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-yellow-400 hover:bg-neutral-800 disabled:opacity-50"
            >
              {busy ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
