// Funis de vendas — kanbans customizáveis criados de três formas:
//   • Aba        → também aparece como aba no topo do WhatsApp Web
//   • Etiqueta   → alimentado por uma etiqueta nativa do WhatsApp
//   • Novo funil → colunas e leads montados manualmente
//
// Os cards seguem o mesmo padrão dos kanbans de assinaturas:
// anotações, mensagem agendada e disparo/abrir conversa no WhatsApp.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatBRL,
  type Funnel,
  type FunnelCard,
  type FunnelMode,
  type WaContact,
  type WaLabel,
} from "@/lib/funnels";
import { isRealPhone, sendWaAction } from "@/lib/wa-actions";

type ApiFn = (path: string, opts?: RequestInit) => Promise<Record<string, unknown>>;

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900";

const MODE_LABEL: Record<FunnelMode, string> = {
  tab: "aba",
  label: "etiqueta",
  manual: "funil",
};

export function FunnelsView({ api }: { api: ApiFn }) {
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [labels, setLabels] = useState<WaLabel[]>([]);
  const [contacts, setContacts] = useState<WaContact[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<FunnelCard | null>(null);
  const [detailTab, setDetailTab] = useState<"notes" | "schedule">("notes");
  const [inboxOpen, setInboxOpen] = useState<string | null>(null);
  const dragged = useRef<FunnelCard | null>(null);

  async function reload() {
    const [f, w] = await Promise.all([
      api("/api/public/extension/funnels"),
      api("/api/public/extension/wa/data"),
    ]);
    if (f?.ok) {
      const list = (f.funnels as Funnel[]) || [];
      setFunnels(list);
      setActiveId((cur) => (cur && list.some((x) => x.id === cur) ? cur : list[0]?.id ?? null));
    } else {
      setErr((f?.error as string) || "Erro ao carregar funis");
    }
    if (w?.ok) {
      setLabels((w.labels as WaLabel[]) || []);
      setContacts((w.contacts as WaContact[]) || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = funnels.find((f) => f.id === activeId) || null;

  const labelContacts = useMemo(() => {
    if (!active || active.mode !== "label" || !active.source_label_id) return [];
    return contacts.filter((c) => (c.label_ids || []).includes(active.source_label_id!));
  }, [active, contacts]);

  async function moveCard(card: FunnelCard, stageId: string) {
    if (card.stage_id === stageId) return;
    setFunnels((list) =>
      list.map((f) =>
        f.id !== card.funnel_id
          ? f
          : { ...f, cards: f.cards.map((c) => (c.id === card.id ? { ...c, stage_id: stageId } : c)) },
      ),
    );
    const r = await api("/api/public/extension/funnel-cards", {
      method: "PATCH",
      body: JSON.stringify({ id: card.id, stage_id: stageId }),
    });
    if (!r?.ok) void reload();
  }

  async function removeCard(card: FunnelCard) {
    setFunnels((list) =>
      list.map((f) => (f.id === card.funnel_id ? { ...f, cards: f.cards.filter((c) => c.id !== card.id) } : f)),
    );
    await api("/api/public/extension/funnel-cards", {
      method: "DELETE",
      body: JSON.stringify({ id: card.id }),
    });
  }

  async function addCard(
    stageId: string | undefined,
    payload: { title: string; phone?: string; value_cents?: number; wa_contact_id?: string },
  ) {
    if (!active || !stageId) return;
    const r = await api("/api/public/extension/funnel-cards", {
      method: "POST",
      body: JSON.stringify({ funnel_id: active.id, stage_id: stageId, ...payload }),
    });
    if (r?.ok) void reload();
    else setErr((r?.error as string) || "Erro ao criar card");
  }

  async function removeFunnel(id: string) {
    await api(`/api/public/extension/funnels/${id}`, { method: "DELETE" });
    setActiveId(null);
    void reload();
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:flex-wrap sm:justify-between">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-neutral-900">Funis de vendas</h2>
          <p className="text-sm text-neutral-500">
            Crie abas, use etiquetas do WhatsApp ou monte um funil do zero — e arraste os leads entre as etapas.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="shrink-0 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-yellow-400 hover:bg-neutral-800"
        >
          + Criar
        </button>
      </div>

      {err && <p className="text-sm text-red-500">{err}</p>}
      {loading && <p className="text-sm text-neutral-500">Carregando...</p>}

      {!loading && funnels.length === 0 && (
        <p className="text-sm text-neutral-500">
          Nenhum funil ainda. Crie o primeiro — as etiquetas e conversas do WhatsApp aparecem aqui depois da
          sincronização feita pela extensão.
        </p>
      )}

      {funnels.length > 0 && (
        <nav className="flex flex-wrap gap-1 rounded-lg bg-neutral-100 p-1">
          {funnels.map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveId(f.id)}
              className={
                "rounded-md px-3 py-1.5 text-xs font-medium transition " +
                (f.id === activeId ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-900")
              }
            >
              {f.name}
              <span className="ml-1 text-[10px] text-yellow-700">{MODE_LABEL[f.mode]}</span>
            </button>
          ))}
        </nav>
      )}

      {active && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
            <span>
              {active.cards.length} lead(s)
              {active.mode === "label" && ` · ${labelContacts.length} contato(s) nessa etiqueta`}
              {active.mode === "tab" && " · aparece como aba no topo do WhatsApp"}
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setInboxOpen(active.stages[0]?.id ?? null)}
                disabled={!active.stages[0]}
                className="rounded-md border border-neutral-300 px-2 py-1 font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
              >
                + Puxar do inbox
              </button>
              <button onClick={() => removeFunnel(active.id)} className="text-red-600 hover:underline">
                excluir
              </button>
            </div>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-4">
            {active.stages.map((stage) => {
              const cards = active.cards.filter((c) => c.stage_id === stage.id);
              const total = cards.reduce((sum, c) => sum + (c.value_cents ?? 0), 0);
              return (
                <div
                  key={stage.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    const card = dragged.current;
                    dragged.current = null;
                    if (card) void moveCard(card, stage.id);
                  }}
                  className="flex w-72 shrink-0 flex-col rounded-xl border border-neutral-200 bg-neutral-50 p-3"
                >
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-sm font-semibold text-neutral-900">{stage.name}</h3>
                    <span className="text-[11px] text-neutral-500">{cards.length}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] font-medium text-neutral-500">{formatBRL(total)}</p>

                  <div className="mt-3 space-y-2">
                    {cards.map((card) => (
                      <div
                        key={card.id}
                        draggable
                        onDragStart={() => {
                          dragged.current = card;
                        }}
                        className="cursor-grab rounded-lg border border-neutral-200 bg-white p-3 shadow-sm active:cursor-grabbing"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 truncate text-sm font-medium text-neutral-900">{card.title}</p>
                          <button
                            onClick={() => removeCard(card)}
                            className="shrink-0 text-[11px] text-neutral-400 hover:text-red-600"
                          >
                            ✕
                          </button>
                        </div>
                        {card.phone && <p className="mt-0.5 text-[11px] text-neutral-500">{card.phone}</p>}
                        {card.value_cents ? (
                          <p className="mt-1 text-[11px] font-semibold text-neutral-700">
                            {formatBRL(card.value_cents)}
                          </p>
                        ) : null}
                        {card.notes && (
                          <span className="mt-1 inline-block rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-700">
                            anotação
                          </span>
                        )}

                        <div className="mt-2 flex items-center gap-1">
                          <CardAction
                            title="Abrir conversa no WhatsApp"
                            disabled={!isRealPhone(card.phone)}
                            onClick={() =>
                              void sendWaAction({ phone: card.phone!, name: card.title, openOnly: true })
                            }
                          >
                            <IconWhatsapp />
                          </CardAction>
                          <CardAction
                            title="Anotações"
                            onClick={() => {
                              setDetailTab("notes");
                              setDetail(card);
                            }}
                          >
                            <IconNote />
                          </CardAction>
                          <CardAction
                            title="Mensagem agendada / disparo"
                            onClick={() => {
                              setDetailTab("schedule");
                              setDetail(card);
                            }}
                          >
                            <IconClock />
                          </CardAction>
                        </div>
                      </div>
                    ))}
                  </div>

                  <AddCardForm onAdd={(payload) => addCard(stage.id, payload)} />
                </div>
              );
            })}
          </div>

          {active.mode === "label" && labelContacts.length > 0 && (
            <div className="rounded-xl border border-neutral-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-neutral-900">
                Contatos da etiqueta ainda fora do funil
              </h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {labelContacts
                  .filter((c) => !active.cards.some((card) => card.wa_contact_id === c.id))
                  .slice(0, 60)
                  .map((c) => (
                    <button
                      key={c.id}
                      onClick={() =>
                        addCard(active.stages[0]?.id, {
                          title: c.name || c.phone || c.wa_id,
                          phone: c.phone ?? undefined,
                          wa_contact_id: c.id,
                        })
                      }
                      disabled={!active.stages[0]}
                      className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50"
                    >
                      + {c.name || c.phone || c.wa_id}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </>
      )}

      {inboxOpen && active && (
        <InboxPicker
          contacts={contacts.filter((c) => !active.cards.some((card) => card.wa_contact_id === c.id))}
          onClose={() => setInboxOpen(null)}
          onPick={(c) => {
            void addCard(inboxOpen, {
              title: c.name || c.phone || c.wa_id,
              phone: c.phone ?? undefined,
              wa_contact_id: c.id,
            });
          }}
        />
      )}

      {detail && (
        <CardDrawer
          api={api}
          card={detail}
          initialTab={detailTab}
          onClose={() => {
            setDetail(null);
            void reload();
          }}
        />
      )}

      {creating && (
        <NewFunnelModal
          labels={labels}
          onClose={() => setCreating(false)}
          onCreate={async (body, labelStages) => {
            const r = await api("/api/public/extension/funnels", {
              method: "POST",
              body: JSON.stringify(body),
            });
            if (!r?.ok) {
              setErr((r?.error as string) || "Erro ao criar funil");
              return;
            }
            setCreating(false);
            const created = r.funnel as Funnel;

            // Etiquetas: cada etiqueta vira uma etapa já preenchida com seus contatos.
            if (labelStages?.length && created?.stages?.length) {
              for (let i = 0; i < labelStages.length; i++) {
                const stage = created.stages[i];
                const label = labelStages[i];
                if (!stage || !label) continue;
                const list = contacts
                  .filter((c) => (c.label_ids || []).includes(label.wa_label_id))
                  .slice(0, 100);
                for (const c of list) {
                  await api("/api/public/extension/funnel-cards", {
                    method: "POST",
                    body: JSON.stringify({
                      funnel_id: created.id,
                      stage_id: stage.id,
                      title: c.name || c.phone || c.wa_id,
                      phone: c.phone ?? undefined,
                      wa_contact_id: c.id,
                    }),
                  });
                }
              }
            }

            await reload();
            setActiveId(created?.id ?? null);
          }}
        />
      )}

    </div>
  );
}

function CardAction({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="rounded-md border border-neutral-200 bg-white p-1.5 text-neutral-600 hover:border-neutral-900 hover:text-neutral-900 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

const IconWhatsapp = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-1.7-.1a10.7 10.7 0 0 1-5.7-5c-.4-.7-.7-1.5-.7-2.2 0-.7.4-1.4.7-1.7.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 1.9c0 .2 0 .3-.1.5l-.4.5c-.1.2-.3.3-.1.6a8 8 0 0 0 3.6 3.1c.3.1.5.1.6-.1l.7-.8c.2-.2.3-.2.6-.1l1.8.9c.3.1.4.2.5.3 0 .1 0 .5-.2 1Z" />
  </svg>
);
const IconNote = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M4 4h16v12l-4 4H4z" />
    <path d="M16 20v-4h4" />
  </svg>
);
const IconClock = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="mt-16 w-full max-w-lg rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-neutral-900">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-neutral-400 hover:text-neutral-900">
            ✕
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

/** Pipeline do lead do funil: anotações + mensagem agendada/disparo. */
function CardDrawer({
  api,
  card,
  initialTab,
  onClose,
}: {
  api: ApiFn;
  card: FunnelCard;
  initialTab: "notes" | "schedule";
  onClose: () => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const [notes, setNotes] = useState(card.notes ?? "");
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function saveNotes() {
    setBusy(true);
    const r = await api("/api/public/extension/funnel-cards", {
      method: "PATCH",
      body: JSON.stringify({ id: card.id, notes: notes.trim() || null }),
    });
    setBusy(false);
    if (!r?.ok) {
      setErr((r?.error as string) || "Erro ao salvar anotação");
      return;
    }
    setErr(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  async function schedule() {
    if (!msg.trim()) return;
    setBusy(true);
    setErr(null);
    const r = await api("/api/public/extension/funnel-cards/schedule", {
      method: "POST",
      body: JSON.stringify({
        card_id: card.id,
        message: msg.trim(),
        scheduled_for: when ? new Date(when).toISOString() : undefined,
      }),
    });
    setBusy(false);
    if (!r?.ok) {
      setErr((r?.error as string) || "Erro ao agendar");
      return;
    }
    setMsg("");
    setFeedback(when ? "Mensagem agendada ✔" : "Mensagem enfileirada para envio ✔");
  }

  return (
    <Overlay title={card.title} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
          {card.phone || "sem telefone"}
          {card.value_cents ? ` · ${formatBRL(card.value_cents)}` : ""}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-neutral-100 p-1">
            {(["notes", "schedule"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={
                  "rounded-md px-3 py-1.5 text-xs font-medium transition " +
                  (tab === t ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-900")
                }
              >
                {t === "notes" ? "Anotações" : "Mensagens agendadas"}
              </button>
            ))}
          </div>
          {isRealPhone(card.phone) && (
            <button
              onClick={() => void sendWaAction({ phone: card.phone!, name: card.title, openOnly: true })}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
            >
              <IconWhatsapp /> WhatsApp
            </button>
          )}
        </div>

        {tab === "notes" && (
          <>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="Histórico, combinados, próximo passo..."
              className={inputCls}
            />
            <div className="flex items-center gap-3">
              <button
                onClick={saveNotes}
                disabled={busy}
                className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
              >
                Salvar anotação
              </button>
              {saved && <span className="text-xs font-medium text-emerald-600">Salvo ✔</span>}
            </div>
          </>
        )}

        {tab === "schedule" && (
          <>
            <textarea
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="Oi {nome}, tudo bem?"
              className={inputCls}
            />
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className={inputCls}
            />
            <button
              onClick={schedule}
              disabled={busy || !msg.trim()}
              className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-yellow-400 hover:bg-neutral-800 disabled:opacity-50"
            >
              {busy ? "Enviando..." : when ? "Agendar mensagem" : "Enviar mensagem"}
            </button>
          </>
        )}

        {err && <p className="text-sm text-red-500">{err}</p>}
        {feedback && <p className="text-sm text-emerald-600">{feedback}</p>}
      </div>
    </Overlay>
  );
}

function InboxPicker({
  contacts,
  onPick,
  onClose,
}: {
  contacts: WaContact[];
  onPick: (c: WaContact) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return contacts
      .filter((c) => !c.is_group)
      .filter((c) => !term || (c.name || "").toLowerCase().includes(term) || (c.phone || "").includes(term))
      .slice(0, 100);
  }, [contacts, q]);

  return (
    <Overlay title="Puxar leads do inbox" onClose={onClose}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar contato…" className={inputCls} />
      <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
        {list.map((c) => (
          <button
            key={c.id}
            onClick={() => onPick(c)}
            className="flex w-full items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-left text-sm hover:bg-neutral-50"
          >
            <span className="min-w-0 truncate">{c.name || c.phone || c.wa_id}</span>
            <span className="ml-2 shrink-0 text-[11px] text-neutral-500">{c.phone}</span>
          </button>
        ))}
        {list.length === 0 && (
          <p className="py-6 text-center text-xs text-neutral-500">
            Nenhuma conversa sincronizada ainda — abra o WhatsApp Web com a extensão ativa.
          </p>
        )}
      </div>
    </Overlay>
  );
}

/** Lista de etapas/abas adicionadas uma a uma (sem vírgulas). */
function StageListEditor({
  label,
  placeholder,
  items,
  onChange,
}: {
  label: string;
  placeholder: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim();
    if (!v || items.includes(v)) return;
    onChange([...items, v]);
    setDraft("");
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-neutral-600">{label}</label>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className={inputCls}
        />
        <button
          onClick={add}
          className="shrink-0 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-yellow-400"
        >
          + adicionar
        </button>
      </div>
      {items.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {items.map((s, i) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 rounded-full border border-neutral-300 bg-neutral-50 px-2.5 py-1 text-xs text-neutral-800"
            >
              {s}
              <button
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                className="text-neutral-400 hover:text-red-600"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function NewFunnelModal({
  labels,
  onClose,
  onCreate,
}: {
  labels: WaLabel[];
  onClose: () => void;
  onCreate: (
    body: {
      name: string;
      mode: FunnelMode;
      source_label_id?: string | null;
      stages?: string[];
    },
    labelStages?: WaLabel[],
  ) => void;
}) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<FunnelMode>("tab");
  const [tabs, setTabs] = useState<string[]>([]);
  const [stages, setStages] = useState<string[]>(["Novo lead", "Em conversa", "Negociando", "Fechado"]);

  const options: Array<{ key: FunnelMode; title: string; desc: string }> = [
    { key: "tab", title: "Aba", desc: "Aparece no topo do WhatsApp Web" },
    { key: "label", title: "Etiquetas", desc: "Cada etiqueta vira uma etapa" },
    { key: "manual", title: "Novo funil", desc: "Colunas e leads manuais" },
  ];

  function submit() {
    if (mode === "label") {
      if (!labels.length) return;
      onCreate(
        {
          name: name.trim() || "Etiquetas do WhatsApp",
          mode: "label",
          source_label_id: null,
          stages: labels.map((l) => l.name),
        },
        labels,
      );
      return;
    }
    if (!name.trim()) return;
    const cols = mode === "tab" ? tabs : stages;
    if (!cols.length) return;
    onCreate({ name: name.trim(), mode, source_label_id: null, stages: cols });
  }

  return (
    <Overlay title="Criar funil" onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {options.map((o) => (
            <button
              key={o.key}
              onClick={() => setMode(o.key)}
              className={
                "rounded-xl border p-3 text-left transition " +
                (mode === o.key ? "border-neutral-900 bg-neutral-900 text-yellow-400" : "border-neutral-300 bg-white")
              }
            >
              <span className="block text-sm font-semibold">{o.title}</span>
              <span className={"mt-1 block text-[11px] " + (mode === o.key ? "text-yellow-200" : "text-neutral-500")}>
                {o.desc}
              </span>
            </button>
          ))}
        </div>

        {mode !== "label" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-600">Nome</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              placeholder={mode === "tab" ? "Ex.: Orçamentos" : "Ex.: Recuperação de inadimplentes"}
            />
          </div>
        )}

        {mode === "tab" && (
          <StageListEditor
            label="Abas (adicione uma por vez)"
            placeholder="Ex.: Leads"
            items={tabs}
            onChange={setTabs}
          />
        )}

        {mode === "manual" && (
          <StageListEditor
            label="Colunas do funil (adicione uma por vez)"
            placeholder="Ex.: Negociando"
            items={stages}
            onChange={setStages}
          />
        )}

        {mode === "label" && (
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
            <p className="text-xs text-neutral-600">
              Todas as etiquetas do WhatsApp viram etapas automaticamente, já com os contatos de cada uma.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {labels.map((l) => (
                <span
                  key={l.id}
                  className="rounded-full border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-800"
                >
                  {l.name} · {l.conversation_count}
                </span>
              ))}
            </div>
            {labels.length === 0 && (
              <p className="mt-2 text-[11px] text-neutral-500">
                Nenhuma etiqueta sincronizada ainda — abra o WhatsApp Web com a extensão ativa.
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm">
            Cancelar
          </button>
          <button
            onClick={submit}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-yellow-400"
          >
            Criar
          </button>
        </div>
      </div>
    </Overlay>
  );
}


function AddCardForm({
  onAdd,
}: {
  onAdd: (payload: { title: string; phone?: string; value_cents?: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [value, setValue] = useState("");

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 rounded-lg border border-dashed border-neutral-300 py-2 text-xs text-neutral-500 hover:bg-neutral-100"
      >
        + adicionar lead
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-neutral-200 bg-white p-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nome" className={inputCls} />
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Telefone" className={inputCls} />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Valor (ex: 97,00)"
        className={inputCls}
      />
      <div className="flex justify-end gap-2">
        <button onClick={() => setOpen(false)} className="rounded px-2 py-1 text-xs text-neutral-500">
          cancelar
        </button>
        <button
          onClick={() => {
            if (!title.trim()) return;
            const cents = Math.round(Number(value.replace(/\./g, "").replace(",", ".")) * 100);
            onAdd({
              title: title.trim(),
              phone: phone.trim() || undefined,
              value_cents: Number.isFinite(cents) && cents > 0 ? cents : undefined,
            });
            setTitle("");
            setPhone("");
            setValue("");
            setOpen(false);
          }}
          className="rounded bg-neutral-900 px-3 py-1 text-xs font-semibold text-yellow-400"
        >
          adicionar
        </button>
      </div>
    </div>
  );
}
