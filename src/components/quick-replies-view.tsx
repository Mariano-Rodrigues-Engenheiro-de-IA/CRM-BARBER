// Respostas rápidas — criação e gestão no painel do CRM.
//
// Cada resposta rápida tem título + lista ordenada de passos (texto, imagem,
// vídeo, áudio, mover/remover no funil), cada um com um tempo de espera
// opcional antes do próximo. A mesma lista é consumida pela extensão dentro
// do WhatsApp Web — os dois lugares têm que ficar sempre no mesmo padrão.

import { useEffect, useRef, useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
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

// ---------------------------------------------------------------------
// Ícones — mesmo traço/peso usado no resto do painel (18px, stroke 1.8).
// ---------------------------------------------------------------------
function IconMini({ type }: { type: QuickReplyActionType | "clock" }) {
  const common = { viewBox: "0 0 24 24", width: 13, height: 13, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (type === "text") return <svg {...common}><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 21l1.9-4.9A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z" /></svg>;
  if (type === "image") return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>;
  if (type === "video") return <svg {...common}><rect x="2.5" y="5.5" width="14" height="13" rx="2" /><path d="M16.5 10.5 21 7.5v9l-4.5-3" /></svg>;
  if (type === "audio") return <svg {...common}><path d="M9 18V6l10-2v12" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>;
  if (type === "clock") return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></svg>;
  // funnel_add / funnel_remove
  return <svg {...common}><path d="M3 4h18l-7 8v7l-4 2v-9L3 4z" /></svg>;
}

function typesIn(qr: QuickReply): QuickReplyActionType[] {
  const seen = new Set<QuickReplyActionType>();
  const out: QuickReplyActionType[] = [];
  for (const a of qr.actions) {
    if (!seen.has(a.type)) { seen.add(a.type); out.push(a.type); }
  }
  return out;
}
function firstText(qr: QuickReply) {
  return qr.actions.find((a) => a.type === "text")?.text?.trim() || "";
}
function hasDelay(qr: QuickReply) {
  return qr.actions.some((a) => typeof a.delay_seconds === "number" && a.delay_seconds > 0);
}

export function QuickRepliesView({ token, api }: { token: string; api: ApiFn }) {
  const { confirm, dialog } = useConfirm();
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

  async function remove(qr: QuickReply) {
    const ok = await confirm({
      title: "Excluir resposta rápida?",
      description: `"${qr.title}" será removida.`,
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    await api(`/api/public/extension/quick-replies/${qr.id}`, { method: "DELETE" });
    void reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setEditing("new")}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong"
        >
          + Nova resposta
        </button>
      </div>

      {err && <p className="text-sm text-red-500">{err}</p>}
      {loading && <p className="text-sm text-neutral-500">Carregando...</p>}

      {!loading && replies.length === 0 && (
        <p className="rounded-xl border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-sm text-neutral-500">
          Nenhuma resposta rápida criada ainda.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {replies.map((qr) => (
          <div
            key={qr.id}
            className="flex flex-col rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition hover:border-neutral-300 hover:shadow"
          >
            <p className="truncate text-sm font-semibold text-neutral-900">{qr.title}</p>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {typesIn(qr).map((t) => (
                <span
                  key={t}
                  title={actionLabel(t)}
                  className="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600"
                >
                  <IconMini type={t} />
                  {actionLabel(t)}
                </span>
              ))}
              {hasDelay(qr) && (
                <span title="Tem tempo de espera configurado" className="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600">
                  <IconMini type="clock" />
                  Temporizado
                </span>
              )}
            </div>

            {firstText(qr) && (
              <p className="mt-2 line-clamp-2 flex-1 text-xs text-neutral-500">{firstText(qr)}</p>
            )}
            {!firstText(qr) && <div className="flex-1" />}

            <p className="mt-3 text-[11px] font-medium text-neutral-400">
              {qr.actions.length} passo{qr.actions.length === 1 ? "" : "s"}
            </p>

            <div className="mt-3 flex gap-2 border-t border-neutral-100 pt-3">
              <button
                onClick={() => setEditing(qr)}
                className="flex-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
              >
                Editar
              </button>
              <button
                onClick={() => remove(qr)}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
              >
                Excluir
              </button>
            </div>
          </div>
        ))}
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
      {dialog}
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
  const [actions, setActions] = useState<QuickReplyAction[]>(
    initial?.actions ?? [{ type: "text", text: "", delay_seconds: 5 }],
  );
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
    const messageType = (QUICK_REPLY_ACTION_TYPES as readonly string[]).includes(type);
    setActions((list) => [
      ...list,
      type === "text"
        ? { type, text: "", delay_seconds: 5 }
        : messageType
          ? { type, delay_seconds: 5 }
          : { type },
    ]);
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
      .map((a) => (a.type === "text" ? { ...a, text: (a.text || "").trim() } : a))
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

  const isMessageStep = (t: QuickReplyActionType) => (QUICK_REPLY_ACTION_TYPES as readonly string[]).includes(t);

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
                  <span className="flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-semibold text-brand">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand text-[9px] font-bold text-white">
                      {i + 1}
                    </span>
                    {actionLabel(a.type)}
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

                {isMessageStep(a.type) && (
                  <label className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
                    Aguardar
                    <input
                      type="number"
                      min={0}
                      max={120}
                      value={a.delay_seconds ?? ""}
                      onChange={(e) =>
                        update(i, { delay_seconds: e.target.value === "" ? undefined : Math.max(0, Math.min(120, Number(e.target.value))) })
                      }
                      placeholder="5"
                      className="w-14 rounded-md border border-neutral-300 bg-white px-1.5 py-1 text-center text-xs text-neutral-900 outline-none focus:border-neutral-900"
                    />
                    segundos antes do próximo passo
                  </label>
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
