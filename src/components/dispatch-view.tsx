// Central de disparo — único lugar do CRM onde se cria campanha.
//
// Público possível:
//   • Assinantes → coluna (status) do kanban de assinaturas
//   • Etiquetas  → etiqueta nativa do WhatsApp já sincronizada (wa_labels)
//   • Funis      → funil + coluna
//
// O conteúdo (mensagem manual ou resposta rápida), o ritmo e o termo de uso
// são idênticos para os três públicos.

import { useEffect, useMemo, useState } from "react";
import { isRealPhone } from "@/lib/wa-actions";
import { sendableActions, type QuickReply } from "@/lib/quick-replies";
import type { Funnel, WaContact, WaLabel } from "@/lib/funnels";

type ApiFn = (path: string, opts?: RequestInit) => Promise<Record<string, unknown>>;

export type DispatchCustomer = { id: string; name: string; phone: string; status: string };

type Audience = "assinantes" | "funis";

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-neutral-900";

function nudgeExtensionPoll() {
  if (typeof window === "undefined") return;
  window.postMessage({ __crm: "poll_now_v180" }, window.location.origin);
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs font-medium text-neutral-600">{children}</label>;
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
  // Etiquetas
  const [labels, setLabels] = useState<WaLabel[]>([]);
  const [contacts, setContacts] = useState<WaContact[]>([]);
  const [labelId, setLabelId] = useState("");
  // Funis
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [funnelId, setFunnelId] = useState("");
  const [stageId, setStageId] = useState("");

  const [name, setName] = useState("");
  const [variants, setVariants] = useState<string[]>([""]);
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [replyId, setReplyId] = useState("");
  const [paceMin, setPaceMin] = useState(20);
  const [paceMax, setPaceMax] = useState(60);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [w, f, q] = await Promise.all([
        api("/api/public/extension/wa/data"),
        api("/api/public/extension/funnels"),
        api("/api/public/extension/quick-replies"),
      ]);
      if (w?.ok) {
        setLabels((w.labels as WaLabel[]) || []);
        setContacts((w.contacts as WaContact[]) || []);
      }
      if (f?.ok) {
        const list = (f.funnels as Funnel[]) || [];
        setFunnels(list);
        setFunnelId((cur) => cur || list[0]?.id || "");
      }
      if (q?.ok) setReplies((q.quick_replies as QuickReply[]) || []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const funnel = funnels.find((f) => f.id === funnelId) || null;

  const sendableSubs = useMemo(() => customers.filter((c) => isRealPhone(c.phone)), [customers]);
  const subsCount = (key: string) =>
    key === "all" ? sendableSubs.length : sendableSubs.filter((c) => c.status === key).length;

  const labelTargets = useMemo(() => {
    const lb = labels.find((l) => l.id === labelId);
    if (!lb) return [];
    return contacts
      .filter((c) => !c.is_group && (c.label_ids || []).includes(lb.wa_label_id) && isRealPhone(c.phone))
      .map((c) => ({ phone: c.phone as string, name: c.name || (c.phone as string) }));
  }, [labels, labelId, contacts]);

  const funnelTargets = useMemo(() => {
    if (!funnel) return [];
    return funnel.cards
      .filter((c) => (stageId ? c.stage_id === stageId : true))
      .filter((c) => isRealPhone(c.phone))
      .map((c) => ({ phone: c.phone as string, name: c.title }));
  }, [funnel, stageId]);

  const total =
    audience === "assinantes"
      ? subsCount(status)
      : audience === "etiquetas"
        ? labelTargets.length
        : funnelTargets.length;

  const selectedReply = replies.find((q) => q.id === replyId);
  const mediaDropped = selectedReply
    ? sendableActions(selectedReply.actions).filter((a) => a.type !== "text").length
    : 0;

  function pickReply(id: string) {
    setReplyId(id);
    const qr = replies.find((q) => q.id === id);
    if (!qr) return;
    const texts = sendableActions(qr.actions)
      .filter((a) => a.type === "text" && a.text?.trim())
      .map((a) => (a.text as string).trim());
    if (texts.length) setVariants(texts.slice(0, 3));
    if (!name.trim()) setName(qr.title);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = variants.map((v) => v.trim()).filter(Boolean);
    if (!name.trim() || cleaned.length === 0) {
      setErr("Preencha o nome e ao menos 1 mensagem.");
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
      setBusy(false);
      setErr("WhatsApp não está conectado. Redirecionando pra aba Conexão…");
      setTimeout(() => onNeedConnection(), 800);
      return;
    }

    const base = {
      name: name.trim(),
      message_variants: cleaned,
      pace_seconds_min: Math.min(paceMin, paceMax),
      pace_seconds_max: Math.max(paceMin, paceMax),
    };
    const body =
      audience === "assinantes"
        ? { ...base, scope: "assinaturas", filter: status === "all" ? {} : { status } }
        : {
            ...base,
            scope: "funil",
            phone_targets: audience === "etiquetas" ? labelTargets : funnelTargets,
          };

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
    { key: "etiquetas", label: "Etiquetas" },
    { key: "funis", label: "Funis de vendas" },
  ];

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-xl space-y-5 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
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
                  ? "border-neutral-800 bg-neutral-800 text-white"
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
              <option key={c.key} value={c.key}>{c.label} ({subsCount(c.key)})</option>
            ))}
            <option value="all">Todos ({subsCount("all")})</option>
          </select>
        </div>
      )}

      {audience === "etiquetas" && (
        <div>
          <Label>Etiqueta do WhatsApp</Label>
          {labels.length === 0 ? (
            <p className="text-xs text-neutral-500">
              Nenhuma etiqueta sincronizada. Crie etiquetas no WhatsApp e abra o WhatsApp Web com a
              extensão para sincronizar.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {labels.map((l) => {
                const count = contacts.filter(
                  (c) => !c.is_group && (c.label_ids || []).includes(l.wa_label_id),
                ).length;
                const on = labelId === l.id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setLabelId(l.id)}
                    className={
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition " +
                      (on
                        ? "border-neutral-800 bg-neutral-800 text-white"
                        : "border-neutral-300 bg-white text-neutral-800 hover:border-neutral-500")
                    }
                  >
                    {l.name} · {count}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {audience === "funis" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Funil</Label>
            <select
              value={funnelId}
              onChange={(e) => { setFunnelId(e.target.value); setStageId(""); }}
              className={inputCls}
            >
              {funnels.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Coluna</Label>
            <select value={stageId} onChange={(e) => setStageId(e.target.value)} className={inputCls}>
              <option value="">Todas as colunas</option>
              {(funnel?.stages ?? []).map((st) => (
                <option key={st.id} value={st.id}>{st.name}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <p className="text-xs text-neutral-500">{total} contato(s) com telefone válido</p>

      <div>
        <Label>Nome do disparo</Label>
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Ex.: Cobrança julho" />
      </div>

      {replies.length > 0 && (
        <div>
          <Label>Resposta rápida (opcional)</Label>
          <select value={replyId} onChange={(e) => pickReply(e.target.value)} className={inputCls}>
            <option value="">— escrever mensagem —</option>
            {replies.map((q) => (
              <option key={q.id} value={q.id}>{q.title}</option>
            ))}
          </select>
          {mediaDropped > 0 && <p className="mt-1 text-xs text-neutral-500">Disparo em massa envia só texto.</p>}
        </div>
      )}

      <div>
        <Label>Variações de mensagem</Label>
        <div className="space-y-2">
          {variants.map((v, i) => (
            <div key={i} className="flex gap-2">
              <textarea
                value={v}
                onChange={(e) => setVariants((p) => p.map((x, idx) => (idx === i ? e.target.value : x)))}
                rows={3}
                placeholder={`Variação ${i + 1}`}
                className={inputCls}
              />
              {variants.length > 1 && (
                <button
                  type="button"
                  onClick={() => setVariants((p) => p.filter((_, idx) => idx !== i))}
                  className="rounded px-2 text-red-500 hover:bg-red-50"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        {variants.length < 3 && (
          <button
            type="button"
            onClick={() => setVariants((p) => [...p, ""])}
            className="mt-2 text-xs font-medium text-neutral-700 hover:underline"
          >
            + Adicionar variação (máx 3)
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Ritmo mínimo (seg)</Label>
          <input type="number" min={5} max={600} value={paceMin} onChange={(e) => setPaceMin(Number(e.target.value))} className={inputCls} />
        </div>
        <div>
          <Label>Ritmo máximo (seg)</Label>
          <input type="number" min={5} max={600} value={paceMax} onChange={(e) => setPaceMax(Number(e.target.value))} className={inputCls} />
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
        <p className="text-sm font-semibold text-neutral-900">Termo de uso</p>
        <p className="mt-2 text-sm leading-relaxed text-neutral-700">
          A pratica de envios em massa ou spam podem ocasionar o banimento do seu número por parte do
          WhatsApp. Envie mensagens apenas para pessoas que gostariam de receber sua mensagem.
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
        className="w-full rounded-lg bg-neutral-800 px-4 py-3 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
      >
        {busy ? "Criando..." : "Disparar"}
      </button>
    </form>
  );
}
