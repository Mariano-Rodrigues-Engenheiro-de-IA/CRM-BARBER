// Composição de mensagem personalizada (não-modelo), Etapa 2 do wizard
// de disparo. Embutida direto na tela, ao lado do preview ao vivo — não
// é mais um modal popup separado (pedido explícito do usuário, 19/09:
// o modal ficava desconectado do resto do fluxo, "parecia amador"
// comparado ao resto do CRM já redesenhado).

import { useRef, useState } from "react";
import {
  actionLabel,
  QUICK_REPLY_ACTION_TYPES,
  QUICK_REPLY_FUNNEL_TYPES,
  type QuickReply,
  type QuickReplyAction,
  type QuickReplyActionType,
} from "@/lib/quick-replies";
import type { Funnel } from "@/lib/funnels";

type MessageMode = "custom" | "quick";
type ApiFn = (path: string, opts?: RequestInit) => Promise<Record<string, unknown>>;

const inputCls =
  "w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-neutral-900";

function acceptedFiles(type: QuickReplyActionType) {
  if (type === "image") return "image/*,.jpg,.jpeg,.png,.webp,.gif";
  if (type === "video") return "video/*,.mp4,.mov,.m4v,.3gp,.webm";
  return "audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.amr";
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });
}

export function MessageComposerStep({
  api,
  funnels,
  replies,
  mode,
  replyId,
  actions,
  variants,
  onMode,
  onPickReply,
  onActions,
  onVariants,
  onClearReply,
}: {
  api: ApiFn;
  funnels: Funnel[];
  replies: QuickReply[];
  mode: MessageMode;
  replyId: string;
  actions: QuickReplyAction[];
  variants: string[];
  onMode: (mode: MessageMode) => void;
  onPickReply: (id: string) => void;
  onActions: React.Dispatch<React.SetStateAction<QuickReplyAction[]>>;
  onVariants: React.Dispatch<React.SetStateAction<string[]>>;
  onClearReply: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploadIndex = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  function updateAction(index: number, patch: Partial<QuickReplyAction>) {
    onActions((list) =>
      list.map((action, current) => (current === index ? { ...action, ...patch } : action)),
    );
  }

  function addAction(type: QuickReplyActionType) {
    onClearReply();
    onActions((list) => [...list, type === "text" ? { type, text: "" } : { type }]);
    if (type === "text" && !variants.length) onVariants([""]);
  }

  async function upload(file: File) {
    const index = uploadIndex.current;
    if (index === null) return;
    setBusy(true);
    setError(null);
    try {
      const dataBase64 = await fileToBase64(file);
      const result = await api("/api/public/extension/quick-replies/upload", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, mime: file.type, data_base64: dataBase64 }),
      });
      if (!result?.ok) throw new Error((result?.error as string) || "Falha no upload");
      updateAction(index, {
        path: result.path as string,
        url: result.url as string,
        mime: result.mime as string,
        filename: result.filename as string,
      });
    } catch (uploadError) {
      setError(String((uploadError as Error)?.message || uploadError));
    } finally {
      setBusy(false);
      uploadIndex.current = null;
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            onMode("custom");
            onClearReply();
          }}
          className={`rounded-lg border px-3 py-2 text-sm font-semibold ${mode === "custom" ? "border-brand bg-brand text-white" : "border-neutral-300 text-neutral-700"}`}
        >
          Criar mensagem
        </button>
        <button
          type="button"
          onClick={() => onMode("quick")}
          className={`rounded-lg border px-3 py-2 text-sm font-semibold ${mode === "quick" ? "border-brand bg-brand text-white" : "border-neutral-300 text-neutral-700"}`}
        >
          Usar resposta rápida
        </button>
      </div>

      {mode === "quick" ? (
        <div className="space-y-2">
          {replies.map((reply) => (
            <button
              key={reply.id}
              type="button"
              onClick={() => onPickReply(reply.id)}
              className={`flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left text-sm ${replyId === reply.id ? "border-neutral-900 bg-neutral-50 font-semibold" : "border-neutral-200"}`}
            >
              <span>{reply.title}</span>
              <span>{reply.actions.length} ação(ões)</span>
            </button>
          ))}
          {!replies.length && (
            <p className="text-sm text-neutral-500">Nenhuma resposta rápida cadastrada.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {actions.map((action, index) => (
            <div
              key={`${action.type}-${index}`}
              className="rounded-lg border border-neutral-200 bg-neutral-50 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-neutral-700">
                  {index + 1}. {actionLabel(action.type)}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onActions((list) => list.filter((_, current) => current !== index))
                  }
                  className="text-xs text-red-600"
                >
                  Remover
                </button>
              </div>
              {action.type === "text" ? (
                <div className="mt-2">
                  <textarea
                    value={variants[0] ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      onVariants([value]);
                      updateAction(index, { text: value });
                    }}
                    rows={3}
                    placeholder="Escreva a mensagem"
                    className={inputCls}
                  />
                </div>
              ) : action.type === "funnel_add" || action.type === "funnel_remove" ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <select
                    value={action.funnel_id ?? ""}
                    onChange={(event) =>
                      updateAction(index, {
                        funnel_id: event.target.value || undefined,
                        stage_id: undefined,
                      })
                    }
                    className={inputCls}
                  >
                    <option value="">Escolha o funil</option>
                    {funnels
                      .filter((funnel) => funnel.mode !== "label")
                      .map((funnel) => (
                        <option key={funnel.id} value={funnel.id}>
                          {funnel.name}
                        </option>
                      ))}
                  </select>
                  {action.type === "funnel_add" && (
                    <select
                      value={action.stage_id ?? ""}
                      onChange={(event) =>
                        updateAction(index, { stage_id: event.target.value || undefined })
                      }
                      className={inputCls}
                    >
                      <option value="">Escolha a coluna</option>
                      {(funnels.find((funnel) => funnel.id === action.funnel_id)?.stages ?? []).map(
                        (stage) => (
                          <option key={stage.id} value={stage.id}>
                            {stage.name}
                          </option>
                        ),
                      )}
                    </select>
                  )}
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      uploadIndex.current = index;
                      if (fileInput.current) fileInput.current.accept = acceptedFiles(action.type);
                      fileInput.current?.click();
                    }}
                    className="rounded-xl border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50"
                  >
                    {action.path
                      ? action.filename || "Trocar arquivo"
                      : `Escolher ${actionLabel(action.type).toLowerCase()}`}
                  </button>
                  <input
                    value={action.caption ?? ""}
                    onChange={(event) => updateAction(index, { caption: event.target.value })}
                    placeholder="Legenda (opcional)"
                    className={inputCls}
                  />
                </div>
              )}
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            {[...QUICK_REPLY_ACTION_TYPES, ...QUICK_REPLY_FUNNEL_TYPES].map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => addAction(type)}
                className="rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-100"
              >
                + {actionLabel(type)}
              </button>
            ))}
          </div>
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
