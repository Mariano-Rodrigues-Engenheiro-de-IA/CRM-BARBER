// Central de disparo — único lugar do CRM onde se cria campanha.
//
// Público possível:
//   • Assinantes → coluna (status) do kanban de assinaturas
//   • Listas     → lista nativa do WhatsApp já sincronizada (wa_labels)
//   • Funis      → funil + coluna
//
// O conteúdo (mensagem manual ou resposta rápida), o ritmo e o termo de uso
// são idênticos para os três públicos.

import { useEffect, useMemo, useRef, useState } from "react";
import { isRealPhone } from "@/lib/wa-actions";
import {
  actionLabel,
  QUICK_REPLY_ACTION_TYPES,
  QUICK_REPLY_FUNNEL_TYPES,
  type QuickReply,
  type QuickReplyAction,
  type QuickReplyActionType,
} from "@/lib/quick-replies";
import type { Funnel, WaContact, WaLabel } from "@/lib/funnels";
import { fileToContacts, type SheetContact } from "@/lib/sheet-contacts";

type ApiFn = (path: string, opts?: RequestInit) => Promise<Record<string, unknown>>;

export type DispatchCustomer = { id: string; name: string; phone: string; status: string };

type Audience = "assinantes" | "funis" | "planilha";
type MessageMode = "custom" | "quick";

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-neutral-900";

function nudgeExtensionPoll() {
  if (typeof window === "undefined") return;
  window.postMessage({ __crm: "poll_now_v180" }, window.location.origin);
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs font-medium text-neutral-600">{children}</label>;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });
}

function acceptedFiles(type: QuickReplyActionType) {
  if (type === "image") return "image/*,.jpg,.jpeg,.png,.webp,.gif";
  if (type === "video") return "video/*,.mp4,.mov,.m4v,.3gp,.webm";
  return "audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.amr";
}

export function DispatchCenter({
  api,
  customers,
  cols,
  onNeedConnection,
  onDone,
}: {
  api: ApiFn;
  customers: DispatchCustomer[];
  cols: Array<{ key: string; label: string }>;
  onNeedConnection: () => void;
  onDone: () => void;
}) {
  const [audience, setAudience] = useState<Audience>("assinantes");

  // Assinantes
  const [status, setStatus] = useState<string>(cols[0]?.key ?? "all");
  // Funis
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [funnelId, setFunnelId] = useState("");
  const [stageId, setStageId] = useState("");
  // Contatos e etiquetas do WhatsApp sincronizados — necessários pra calcular
  // corretamente o público de funis do tipo "label" (Listas), já que os
  // cards dessas colunas não ficam persistidos em funnel_cards; eles são
  // recalculados na hora, igual em funnels-view.tsx (stageCards).
  const [contacts, setContacts] = useState<WaContact[]>([]);
  const [labels, setLabels] = useState<WaLabel[]>([]);
  // Planilha importada (Nome + Telefone) usada como público avulso.
  const [sheetContacts, setSheetContacts] = useState<SheetContact[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [sheetErr, setSheetErr] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [variants, setVariants] = useState<string[]>([""]);
  const [actions, setActions] = useState<QuickReplyAction[]>([{ type: "text", text: "" }]);
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [replyId, setReplyId] = useState("");
  const [messageOpen, setMessageOpen] = useState(false);
  const [messageMode, setMessageMode] = useState<MessageMode>("custom");
  const [paceMin, setPaceMin] = useState(20);
  const [paceMax, setPaceMax] = useState(60);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [f, q, w] = await Promise.all([
        api("/api/public/extension/funnels"),
        api("/api/public/extension/quick-replies"),
        api("/api/public/extension/wa/data"),
      ]);
      if (f?.ok) {
        const list = (f.funnels as Funnel[]) || [];
        setFunnels(list);
        setFunnelId((cur) => cur || list[0]?.id || "");
      }
      if (q?.ok) setReplies((q.quick_replies as QuickReply[]) || []);
      if (w?.ok) {
        setLabels((w.labels as WaLabel[]) || []);
        setContacts((w.contacts as WaContact[]) || []);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const funnel = funnels.find((f) => f.id === funnelId) || null;

  const sendableSubs = useMemo(() => customers.filter((c) => isRealPhone(c.phone)), [customers]);
  const subsCount = (key: string) =>
    key === "all" ? sendableSubs.length : sendableSubs.filter((c) => c.status === key).length;

  const funnelTargets = useMemo(() => {
    if (!funnel) return [];
    // Funis do tipo "label" (Listas) não têm cards persistidos em
    // funnel_cards — precisam ser recalculados a partir dos contatos
    // sincronizados e da etiqueta correspondente à coluna selecionada,
    // igual em funnels-view.tsx (stageCards).
    if (funnel.mode === "label") {
      const relevantStages = stageId
        ? funnel.stages.filter((s) => s.id === stageId)
        : funnel.stages;
      const wantedLabelIds = new Set(
        relevantStages
          .map((s) => labels.find((l) => l.name === s.name)?.wa_label_id)
          .filter((x): x is string => Boolean(x)),
      );
      return contacts
        .filter((c) => !c.is_group && c.label_ids.some((id) => wantedLabelIds.has(id)))
        .map((c) => ({ phone: (c.phone || c.wa_id) as string, name: c.name || c.phone || c.wa_id }));
    }
    return funnel.cards
      .filter((c) => (stageId ? c.stage_id === stageId : true))
      // Aceita telefone real OU wa_id (contato "desconhecido" ainda é um
      // destinatário válido — a extensão já sabe mandar mensagem por wa_id).
      .filter((c) => isRealPhone(c.phone) || c.wa_id)
      .map((c) => ({ phone: (c.phone || c.wa_id) as string, name: c.title }));
  }, [funnel, stageId, contacts, labels]);

  const total =
    audience === "assinantes"
      ? subsCount(status)
      : audience === "planilha"
        ? sheetContacts.length
        : funnelTargets.length;

  function pickReply(id: string) {
    setReplyId(id);
    const qr = replies.find((q) => q.id === id);
    if (!qr) return;
    setActions(qr.actions);
    const texts = qr.actions
      .filter((a) => a.type === "text" && a.text?.trim())
      .map((a) => (a.text as string).trim());
    setVariants(texts.length ? texts.slice(0, 3) : [""]);
    if (!name.trim()) setName(qr.title);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = variants.map((v) => v.trim()).filter(Boolean);
    const cleanActions = actions.filter((action) => {
      if (action.type === "text") return Boolean(action.text?.trim() || cleaned.length);
      if (action.type === "funnel_add") return Boolean(action.funnel_id && action.stage_id);
      if (action.type === "funnel_remove") return Boolean(action.funnel_id);
      return Boolean(action.path);
    });
    if (!name.trim() || cleanActions.length === 0) {
      setErr("Preencha o nome e defina a mensagem do disparo.");
      return;
    }
    if (!accepted) {
      setErr("Você precisa aceitar o termo de uso para disparar.");
      return;
    }
    if (total === 0) {
      setErr("Nenhum contato com telefone válido nesse público.");
      return;
    }

    setBusy(true);
    setErr(null);
    const st = await api("/api/public/extension/whatsapp/status?sync=1");
    const conn = st?.connection as { status?: string } | undefined;
    if (!st?.ok || conn?.status !== "connected") {
      // Sem conexão: leva direto pra aba Conexão, sem erro vermelho na tela.
      setBusy(false);
      onNeedConnection();
      return;
    }

    const base = {
      name: name.trim(),
      message_variants: cleaned.length ? cleaned : undefined,
      message_actions: cleanActions,
      pace_seconds_min: Math.min(paceMin, paceMax),
      pace_seconds_max: Math.max(paceMin, paceMax),
    };
    const body =
      audience === "assinantes"
        ? { ...base, scope: "assinaturas", filter: status === "all" ? {} : { status } }
        : audience === "planilha"
          ? { ...base, scope: "funil", phone_targets: sheetContacts }
          : { ...base, scope: "funil", phone_targets: funnelTargets };

    const r = await api("/api/public/extension/campaigns", {
      method: "POST",
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!r?.ok) {
      setErr((r?.error as string) || "Erro ao criar o disparo");
      return;
    }
    nudgeExtensionPoll();
    onDone();
  }

  const audienceOptions: Array<{ key: Audience; label: string }> = [
    { key: "assinantes", label: "Assinantes" },
    { key: "funis", label: "Funis de vendas" },
    { key: "planilha", label: "Importar planilha" },
  ];

  return (
    <form
      onSubmit={submit}
      className="mx-auto w-full max-w-xl space-y-5 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
    >
      <h2 className="text-center text-lg font-semibold text-neutral-900">Novo disparo</h2>

      <div>
        <Label>Público</Label>
        <div className="grid grid-cols-3 gap-2">
          {audienceOptions.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setAudience(o.key)}
              className={
                "rounded-xl border px-3 py-2.5 text-sm font-semibold transition " +
                (audience === o.key
                  ? "border-brand bg-brand text-white"
                  : "border-neutral-300 bg-white text-neutral-800 hover:border-neutral-500")
              }
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {audience === "assinantes" && (
        <div>
          <Label>Kanban de assinantes</Label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
            {cols.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label} ({subsCount(c.key)})
              </option>
            ))}
            <option value="all">Todos ({subsCount("all")})</option>
          </select>
        </div>
      )}

      {audience === "funis" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Funil</Label>
            <select
              value={funnelId}
              onChange={(e) => {
                setFunnelId(e.target.value);
                setStageId("");
              }}
              className={inputCls}
            >
              {funnels.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Coluna</Label>
            <select
              value={stageId}
              onChange={(e) => setStageId(e.target.value)}
              className={inputCls}
            >
              <option value="">Todas as colunas</option>
              {(funnel?.stages ?? []).map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {audience === "planilha" && (
        <div>
          <Label>Planilha (.xlsx, .xls ou .csv) com as colunas Nome e Telefone</Label>
          <input
            type="file"
            accept=".xlsx,.xls,.csv,.tsv,.txt"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setSheetErr(null);
              try {
                const rows = await fileToContacts(file);
                if (!rows.length) {
                  setSheetContacts([]);
                  setSheetErr("Nenhum contato válido. A planilha precisa ter Nome e Telefone.");
                  return;
                }
                setSheetContacts(rows);
                setSheetName(file.name);
                if (!name.trim()) setName(file.name.replace(/\.[^.]+$/, ""));
              } catch {
                setSheetContacts([]);
                setSheetErr("Não consegui ler esse arquivo.");
              }
            }}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 file:mr-3 file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
          />
          {sheetName && sheetContacts.length > 0 && (
            <p className="mt-1 text-xs text-neutral-500">
              {sheetName} — {sheetContacts.length} contato(s) prontos para disparo.
            </p>
          )}
          {sheetErr && <p className="mt-1 text-xs text-red-500">{sheetErr}</p>}
        </div>
      )}

      <p className="text-xs text-neutral-500">{total} contato(s) com telefone válido</p>

      <div>
        <Label>Nome do disparo</Label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputCls}
          placeholder="Ex.: Cobrança julho"
        />
      </div>

      <div>
        <Label>Mensagem</Label>
        <button
          type="button"
          onClick={() => setMessageOpen(true)}
          className="flex w-full items-center justify-between rounded-lg border border-neutral-300 bg-white px-3 py-3 text-left text-sm text-neutral-900 hover:border-neutral-500"
        >
          <span className="min-w-0 truncate">
            {replyId
              ? replies.find((reply) => reply.id === replyId)?.title
              : actions.some((action) => action.type !== "text") ||
                  variants.some((variant) => variant.trim())
                ? `${actions.length} ação(ões) definida(s)`
                : "Definir mensagem"}
          </span>
          <span aria-hidden="true" className="text-neutral-400">
            ›
          </span>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Ritmo mínimo (seg)</Label>
          <input
            type="number"
            min={5}
            max={600}
            value={paceMin}
            onChange={(e) => setPaceMin(Number(e.target.value))}
            className={inputCls}
          />
        </div>
        <div>
          <Label>Ritmo máximo (seg)</Label>
          <input
            type="number"
            min={5}
            max={600}
            value={paceMax}
            onChange={(e) => setPaceMax(Number(e.target.value))}
            className={inputCls}
          />
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
        <p className="text-sm font-semibold text-neutral-900">Termo de uso</p>
        <p className="mt-2 text-sm leading-relaxed text-neutral-700">
          A pratica de envios em massa ou spam podem ocasionar o banimento do seu número por parte
          do WhatsApp. Envie mensagens apenas para pessoas que gostariam de receber sua mensagem.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-neutral-900">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="h-4 w-4 rounded border-neutral-400"
          />
          Eu entendo e aceito os termos de uso.
        </label>
      </div>

      {err && <p className="text-sm text-red-500">{err}</p>}

      <button
        disabled={busy || !accepted}
        className="w-full rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
      >
        {busy ? "Criando..." : "Disparar"}
      </button>

      {messageOpen && (
        <MessageComposer
          api={api}
          funnels={funnels}
          replies={replies}
          mode={messageMode}
          replyId={replyId}
          actions={actions}
          variants={variants}
          onClose={() => setMessageOpen(false)}
          onMode={setMessageMode}
          onPickReply={pickReply}
          onActions={setActions}
          onVariants={setVariants}
          onClearReply={() => setReplyId("")}
        />
      )}
    </form>
  );
}

function MessageComposer({
  api,
  funnels,
  replies,
  mode,
  replyId,
  actions,
  variants,
  onClose,
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
  onClose: () => void;
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
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="mt-8 w-full max-w-2xl rounded-xl border border-neutral-200 bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-neutral-900">Mensagem do disparo</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
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
            Resposta rápida
          </button>
        </div>

        {mode === "quick" ? (
          <div className="mt-4 space-y-2">
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
          <div className="mt-4 space-y-3">
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
                  <div className="mt-2 space-y-2">
                    {variants.map((variant, variantIndex) => (
                      <textarea
                        key={variantIndex}
                        value={variant}
                        onChange={(event) => {
                          const value = event.target.value;
                          onVariants((list) =>
                            list.map((item, current) => (current === variantIndex ? value : item)),
                          );
                          if (variantIndex === 0) updateAction(index, { text: value });
                        }}
                        rows={3}
                        placeholder={`Variação ${variantIndex + 1}`}
                        className={inputCls}
                      />
                    ))}
                    {variants.length < 3 && (
                      <button
                        type="button"
                        onClick={() => onVariants((list) => [...list, ""])}
                        className="text-xs font-medium text-neutral-700"
                      >
                        + Adicionar variação
                      </button>
                    )}
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
                        {(
                          funnels.find((funnel) => funnel.id === action.funnel_id)?.stages ?? []
                        ).map((stage) => (
                          <option key={stage.id} value={stage.id}>
                            {stage.name}
                          </option>
                        ))}
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
                        if (fileInput.current)
                          fileInput.current.accept = acceptedFiles(action.type);
                        fileInput.current?.click();
                      }}
                      className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50"
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
                  className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-100"
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
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
}
