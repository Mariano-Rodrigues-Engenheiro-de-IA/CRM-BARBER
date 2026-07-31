// Funis de vendas — kanbans customizáveis criados de três formas:
//   • Aba        → também aparece como aba no topo do WhatsApp Web
//   • Listas     → alimentado por uma lista (etiqueta) nativa do WhatsApp
//   • Novo funil → colunas e leads montados manualmente
//
// Os cards seguem o mesmo padrão dos kanbans de assinaturas:
// anotações, mensagem agendada e disparo/abrir conversa no WhatsApp.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  type Funnel,
  type FunnelCard,
  type FunnelMode,
  type WaContact,
  type WaLabel,
} from "@/lib/funnels";
import { applyFunnelActions, canOpenWhatsapp, isRealPhone, openWhatsappChat } from "@/lib/wa-actions";
import { sendableActions, type QuickReply } from "@/lib/quick-replies";

type ApiFn = (path: string, opts?: RequestInit) => Promise<Record<string, unknown>>;

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900";


/** Cache entre navegações: voltar pra aba Funis não deve piscar esqueleto. */
let funnelsCache: { funnels: Funnel[]; labels: WaLabel[]; contacts: WaContact[] } | null = null;

export function FunnelsView({ api, headerHost }: { api: ApiFn; headerHost?: HTMLElement | null }) {
  const [funnels, setFunnels] = useState<Funnel[]>(() => funnelsCache?.funnels ?? []);
  const [labels, setLabels] = useState<WaLabel[]>(() => funnelsCache?.labels ?? []);
  const [contacts, setContacts] = useState<WaContact[]>(() => funnelsCache?.contacts ?? []);
  const [activeId, setActiveId] = useState<string | null>(() => funnelsCache?.funnels[0]?.id ?? null);
  const [loading, setLoading] = useState(!funnelsCache);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<FunnelCard | null>(null);
  const [detailTab, setDetailTab] = useState<"notes" | "schedule">("notes");
  const [inboxQuery, setInboxQuery] = useState("");
  const [renamingStage, setRenamingStage] = useState<string | null>(null);
  const dragged = useRef<FunnelCard | null>(null);
  const draggedContact = useRef<WaContact | null>(null);
  const pendingContacts = useRef<Set<string>>(new Set());
  const ensuredDefaults = useRef(false);

  async function reload() {
    const [f, w] = await Promise.all([
      api("/api/public/extension/funnels"),
      api("/api/public/extension/wa/data"),
    ]);
    let list: Funnel[] = funnelsCache?.funnels ?? [];
    if (f?.ok) {
      list = (f.funnels as Funnel[]) || [];
      setFunnels(list);
      setActiveId((cur) => (cur && list.some((x) => x.id === cur) ? cur : list[0]?.id ?? null));
    } else {
      setErr((f?.error as string) || "Erro ao carregar funis");
    }
    let ls = funnelsCache?.labels ?? [];
    let cs = funnelsCache?.contacts ?? [];
    if (w?.ok) {
      ls = (w.labels as WaLabel[]) || [];
      cs = (w.contacts as WaContact[]) || [];
      setLabels(ls);
      setContacts(cs);
    }
    funnelsCache = { funnels: list, labels: ls, contacts: cs };
    setLoading(false);
    return { list, labels: ls };
  }

  /**
   * "Funil principal" e "Listas" são fixos: nascem sozinhos e
   * não podem ser excluídos. O botão do cabeçalho só cria funis personalizados.
   */
  async function ensureDefaults(list: Funnel[], ls: WaLabel[]) {
    if (ensuredDefaults.current) return;
    ensuredDefaults.current = true;
    let created = false;
    if (!list.some((f) => f.mode === "tab")) {
      const r = await api("/api/public/extension/funnels", {
        method: "POST",
        body: JSON.stringify({
          name: "Funil principal",
          mode: "tab",
          stages: ["Novo lead", "Em conversa", "Negociando", "Fechado"],
        }),
      });
      created = created || Boolean(r?.ok);
    }
    // Renomeia o funil de listas criado com o nome antigo ("Etiquetas / Listas").
    const legacy = list.find((f) => f.mode === "label" && f.name !== "Listas");
    if (legacy) {
      const r = await api(`/api/public/extension/funnels/${legacy.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: "Listas" }),
      });
      created = created || Boolean(r?.ok);
    }
    if (!list.some((f) => f.mode === "label")) {
      const r = await api("/api/public/extension/funnels", {
        method: "POST",
        body: JSON.stringify({
          name: "Listas",
          mode: "label",
          stages: ls.map((l) => l.name),
        }),
      });
      created = created || Boolean(r?.ok);

      // Cada lista vira uma coluna já preenchida com os contatos dela.
      const funnel = r?.ok ? (r.funnel as Funnel) : null;
      if (funnel?.stages?.length) {
        for (let i = 0; i < ls.length; i++) {
          const stage = funnel.stages[i];
          const label = ls[i];
          if (!stage || !label) continue;
          const inLabel = (funnelsCache?.contacts ?? [])
            .filter((c) => (c.label_ids || []).includes(label.wa_label_id))
            .slice(0, 100);
          for (const c of inLabel) {
            await api("/api/public/extension/funnel-cards", {
              method: "POST",
              body: JSON.stringify({
                funnel_id: funnel.id,
                stage_id: stage.id,
                title: c.name || c.phone || c.wa_id,
                phone: c.phone ?? undefined,
                wa_contact_id: c.id,
              }),
            });
          }
        }
      }
    }

    if (created) await reload();
  }

  useEffect(() => {
    void reload().then((r) => {
      if (r) void ensureDefaults(r.list, r.labels);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const active = funnels.find((f) => f.id === activeId) || null;

  const inboxContacts = useMemo(() => {
    if (!active) return [];
    const used = new Set(active.cards.map((card) => card.wa_contact_id).filter(Boolean) as string[]);
    return contacts.filter((c) => !c.is_group).filter((c) => !used.has(c.id));
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
    payload: { title: string; phone?: string; wa_contact_id?: string },
  ) {
    if (!active || !stageId) return;
    // Guard: um mesmo contato só pode entrar uma vez no funil (constraint
    // funnel_cards_unique_contact). Sem isso, o drop repetido enquanto a
    // requisição está em voo criava duas inserções.
    const key = payload.wa_contact_id;
    if (key) {
      if (pendingContacts.current.has(key)) return;
      if (active.cards.some((c) => c.wa_contact_id === key)) return;
      pendingContacts.current.add(key);
    }

    const funnelId = active.id;
    // Card otimista: some do Inbox e aparece na coluna na hora (sem delay).
    const tempId = `tmp-${key ?? Math.random().toString(36).slice(2)}`;
    setFunnels((list) =>
      list.map((f) =>
        f.id !== funnelId
          ? f
          : {
              ...f,
              cards: [
                ...f.cards,
                {
                  id: tempId,
                  funnel_id: funnelId,
                  stage_id: stageId,
                  title: payload.title,
                  phone: payload.phone ?? null,
                  value_cents: null,
                  notes: null,
                  sort_order: f.cards.length,
                  customer_id: null,
                  wa_contact_id: key ?? null,
                } as FunnelCard,
              ],
            },
      ),
    );

    const r = await api("/api/public/extension/funnel-cards", {
      method: "POST",
      body: JSON.stringify({ funnel_id: funnelId, stage_id: stageId, ...payload }),
    });
    if (key) pendingContacts.current.delete(key);
    if (r?.ok && r.card) {
      const created = r.card as FunnelCard;
      setFunnels((list) =>
        list.map((f) =>
          f.id !== funnelId ? f : { ...f, cards: f.cards.map((c) => (c.id === tempId ? created : c)) },
        ),
      );
      return created;
    }
    setErr((r?.error as string) || "Erro ao criar card");
    void reload();
    return null;
  }

  /** Contato do Inbox vira lead na primeira etapa para ganhar pipeline. */
  async function promoteContact(c: WaContact, tab: "notes" | "schedule") {
    const stageId = active?.stages[0]?.id;
    if (!stageId) return;
    const created = await addCard(stageId, {
      title: c.name || c.phone || c.wa_id,
      phone: c.phone ?? undefined,
      wa_contact_id: c.id,
    });
    if (!created) return;
    setDetailTab(tab);
    setDetail(created);
  }


  async function removeFunnel(id: string) {
    await api(`/api/public/extension/funnels/${id}`, { method: "DELETE" });
    setActiveId(null);
    void reload();
  }

  /** Renomeia uma coluna do funil ativo. */
  async function renameStage(stage: { id: string; name: string; sort_order: number }, name: string) {
    if (!active || !name.trim() || name.trim() === stage.name) return;
    const funnelId = active.id;
    setFunnels((list) =>
      list.map((f) =>
        f.id !== funnelId
          ? f
          : { ...f, stages: f.stages.map((s) => (s.id === stage.id ? { ...s, name: name.trim() } : s)) },
      ),
    );
    await api(`/api/public/extension/funnels/${funnelId}`, {
      method: "PATCH",
      body: JSON.stringify({ stages: [{ id: stage.id, name: name.trim(), sort_order: stage.sort_order }] }),
    });
  }

  /** Remove uma coluna (e os cards dela, em cascata no banco). */
  async function removeStage(stageId: string) {
    if (!active) return;
    const funnelId = active.id;
    setFunnels((list) =>
      list.map((f) =>
        f.id !== funnelId
          ? f
          : {
              ...f,
              stages: f.stages.filter((s) => s.id !== stageId),
              cards: f.cards.filter((c) => c.stage_id !== stageId),
            },
      ),
    );
    await api(`/api/public/extension/funnels/${funnelId}`, {
      method: "PATCH",
      body: JSON.stringify({ removed_stage_ids: [stageId] }),
    });
  }

  async function renameFunnel(id: string, name: string) {
    if (!name.trim()) return;
    setFunnels((list) => list.map((f) => (f.id === id ? { ...f, name: name.trim() } : f)));
    await api(`/api/public/extension/funnels/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: name.trim() }),
    });
  }

  const header = (
    <>
      <FunnelPicker
        funnels={funnels}
        activeId={activeId}
        onSelect={setActiveId}
        onRename={renameFunnel}
        onRemove={removeFunnel}
      />
      <button
        onClick={() => setCreating(true)}
        className="shrink-0 rounded-lg bg-neutral-800 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white transition hover:bg-neutral-700"
      >
        Novo funil
      </button>

    </>
  );

  return (
    <div className="space-y-3">
      {headerHost ? createPortal(header, headerHost) : <div className="flex items-center gap-2">{header}</div>}

      {err && <p className="text-sm text-red-500">{err}</p>}

      {loading && (
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[calc(100vh-170px)] w-72 shrink-0 animate-pulse rounded-xl border border-neutral-200 bg-neutral-50"
            />
          ))}
        </div>
      )}

      {!loading && funnels.length === 0 && (
        <p className="text-sm text-neutral-500">Nenhum funil ainda. Use “Criar” para começar.</p>
      )}

      {active && (
        <>



          <div className="flex gap-3 overflow-x-auto pb-2">
            <div className="flex w-72 shrink-0 flex-col rounded-xl border border-neutral-200 bg-neutral-50 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-900">Inbox</h3>
                <span className="shrink-0 rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-semibold text-neutral-700">
                  {inboxContacts.length}
                </span>
              </div>
              <input
                value={inboxQuery}
                onChange={(e) => setInboxQuery(e.target.value)}
                placeholder="Buscar"
                className="mt-2 w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs outline-none focus:border-neutral-900"
              />
              <div className="mt-3 max-h-[calc(100vh-215px)] space-y-2 overflow-y-auto pr-1">
                {inboxContacts
                  .filter((c) => {
                    const t = inboxQuery.trim().toLowerCase();
                    if (!t) return true;
                    return (c.name || "").toLowerCase().includes(t) || (c.phone || "").includes(t);
                  })
                  .map((c) => (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={() => {
                        draggedContact.current = c;
                        dragged.current = null;
                      }}
                      className="cursor-grab rounded-lg border border-neutral-200 bg-white p-3 shadow-sm active:cursor-grabbing"
                    >
                      <p className="truncate text-sm font-medium text-neutral-900">{c.name || c.phone || c.wa_id}</p>
                      {isRealPhone(c.phone) && (
                        <p className="mt-0.5 truncate text-[11px] text-neutral-500">{c.phone}</p>
                      )}
                      <div className="mt-2 flex items-center gap-1">
                        <CardAction
                          title="Abrir conversa no WhatsApp"
                          disabled={!canOpenWhatsapp(c.phone, c.wa_id)}
                          onClick={() => void openWhatsappChat(c.phone || "", c.name || undefined, c.wa_id)}
                        >
                          <IconWhatsapp />
                        </CardAction>
                        <CardAction title="Anotações" onClick={() => void promoteContact(c, "notes")}>
                          <IconNote />
                        </CardAction>
                        <CardAction
                          title="Mensagem agendada / disparo"
                          onClick={() => void promoteContact(c, "schedule")}
                        >
                          <IconClock />
                        </CardAction>
                      </div>
                    </div>
                  ))}
              </div>
            </div>


            {active.stages.map((stage) => {
              const cards = active.cards.filter((c) => c.stage_id === stage.id);
              return (
                <div
                  key={stage.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    const contact = draggedContact.current;
                    const card = dragged.current;
                    draggedContact.current = null;
                    dragged.current = null;
                    if (contact) {
                      void addCard(stage.id, {
                        title: contact.name || contact.phone || contact.wa_id,
                        phone: contact.phone ?? undefined,
                        wa_contact_id: contact.id,
                      });
                      return;
                    }
                    if (card) void moveCard(card, stage.id);
                  }}
                  className="flex w-72 shrink-0 flex-col rounded-xl border border-neutral-200 bg-neutral-50 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <StageTitle
                      name={stage.name}
                      editing={renamingStage === stage.id}
                      onRename={(n: string) => {
                        setRenamingStage(null);
                        void renameStage(stage, n);
                      }}
                      onCancel={() => setRenamingStage(null)}
                    />
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="text-[11px] text-neutral-500">{cards.length}</span>
                      <DotsMenu
                        items={[
                          { label: "Renomear", onClick: () => setRenamingStage(stage.id) },
                          { label: "Excluir", danger: true, onClick: () => void removeStage(stage.id) },
                        ]}
                      />
                    </div>
                  </div>

                  <div className="mt-3 max-h-[calc(100vh-215px)] space-y-2 overflow-y-auto pr-1">
                    {cards.map((card) => (
                      <div
                        key={card.id}
                        draggable
                        onDragStart={() => {
                          dragged.current = card;
                          draggedContact.current = null;
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
                        {isRealPhone(card.phone) && (
                          <p className="mt-0.5 text-[11px] text-neutral-500">{card.phone}</p>
                        )}
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
                              void openWhatsappChat(card.phone!, card.title)
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
        </>
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
          onClose={() => setCreating(false)}
          onCreate={async (body) => {
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
            await reload();
            setActiveId(created?.id ?? null);
          }}
        />
      )}


    </div>
  );
}

/** Título editável de uma coluna do funil. */
function StageTitle({
  name,
  editing,
  onRename,
  onCancel,
}: {
  name: string;
  editing: boolean;
  onRename: (name: string) => void;
  onCancel: () => void;
}) {
  if (!editing) {
    return (
      <h3 className="truncate text-sm font-semibold uppercase tracking-wide text-neutral-900">{name}</h3>
    );
  }
  return (
    <input
      autoFocus
      defaultValue={name}
      onBlur={(e) => onRename(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onRename((e.target as HTMLInputElement).value);
        if (e.key === "Escape") onCancel();
      }}
      className="w-full min-w-0 rounded-md border border-neutral-300 px-2 py-1 text-sm font-semibold uppercase tracking-wide text-neutral-900 outline-none focus:border-neutral-900"
    />
  );
}

/** Menu de três pontos reutilizável (colunas e funis). */
function DotsMenu({ items }: { items: { label: string; onClick: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        title="Opções"
        className="rounded-md px-1 text-neutral-400 transition hover:text-neutral-900"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-6 z-20 w-36 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-lg">
          {items.map((it) => (
            <button
              key={it.label}
              onMouseDown={(e) => {
                e.preventDefault();
                setOpen(false);
                it.onClick();
              }}
              className={
                "block w-full px-3 py-1.5 text-left text-xs transition hover:bg-neutral-100 " +
                (it.danger ? "text-red-600" : "text-neutral-700")
              }
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** "FUNIS DE VENDAS" vira o seletor de funil: só um funil por vez na tela. */
function FunnelPicker({
  funnels,
  activeId,
  onSelect,
  onRename,
  onRemove,
}: {
  funnels: Funnel[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const active = funnels.find((f) => f.id === activeId) || null;

  if (renaming && active) {
    return (
      <input
        autoFocus
        defaultValue={active.name}
        onBlur={(e) => {
          setRenaming(false);
          onRename(active.id, e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setRenaming(false);
        }}
        className="min-w-0 rounded-md border border-neutral-300 px-2 py-1 text-[13px] font-semibold uppercase tracking-widest text-neutral-900 outline-none focus:border-neutral-900"
      />
    );
  }

  return (
    <div className="relative flex min-w-0 items-center gap-1">
      <button
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold uppercase tracking-widest text-neutral-900"
      >
        <span className="truncate">{active ? active.name : "Funis de vendas"}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {/* Funis fixos (Funil principal e Listas) não podem ser renomeados nem excluídos. */}
      {active && active.mode === "manual" && (
        <DotsMenu
          items={[
            { label: "Renomear", onClick: () => setRenaming(true) },
            { label: "Excluir", danger: true, onClick: () => onRemove(active.id) },
          ]}
        />
      )}

      {open && funnels.length > 0 && (
        <div className="absolute left-0 top-7 z-30 w-56 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-lg">
          {funnels.map((f) => (
            <button
              key={f.id}
              onMouseDown={(e) => {
                e.preventDefault();
                setOpen(false);
                onSelect(f.id);
              }}
              className={
                "block w-full truncate px-3 py-1.5 text-left text-xs transition hover:bg-neutral-100 " +
                (f.id === activeId ? "font-semibold text-neutral-900" : "text-neutral-600")
              }
            >
              {f.name}
            </button>
          ))}
        </div>
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
          {isRealPhone(card.phone) ? card.phone : "sem telefone"}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-neutral-100 p-1">
            {(["notes", "schedule"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={
                  "rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition " +
                  (tab === t ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-900")
                }
              >
                {t === "notes" ? "Anotações" : "Mensagens agendadas"}
              </button>
            ))}
          </div>
          {isRealPhone(card.phone) && (
            <button
              onClick={() => void openWhatsappChat(card.phone!, card.title)}
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
              className="w-full rounded-lg bg-neutral-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
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

/** Só cria funis personalizados: os fixos nascem automaticamente. */
function NewFunnelModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (body: { name: string; mode: FunnelMode; source_label_id?: string | null; stages?: string[] }) => void;
}) {
  const [name, setName] = useState("");
  // O funil já nasce com a estrutura montada aqui: nome + abas (etapas).
  const [stages, setStages] = useState<string[]>(["", ""]);

  const cleanStages = stages.map((s) => s.trim()).filter(Boolean);
  const canSubmit = Boolean(name.trim()) && cleanStages.length > 0;

  function setStage(i: number, value: string) {
    setStages((prev) => prev.map((s, idx) => (idx === i ? value : s)));
  }

  function submit() {
    if (!canSubmit) return;
    onCreate({ name: name.trim(), mode: "manual", source_label_id: null, stages: cleanStages });
  }

  return (
    <Overlay title="Novo funil" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-600">Nome</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
            placeholder="Ex.: Recuperação"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-600">Abas do funil</label>
          <div className="space-y-2">
            {stages.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={s}
                  onChange={(e) => setStage(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && i === stages.length - 1) setStages((p) => [...p, ""]);
                  }}
                  className={inputCls}
                  placeholder={`Aba ${i + 1} (ex.: ${i === 0 ? "Novo lead" : "Fechado"})`}
                />
                <button
                  type="button"
                  onClick={() => setStages((p) => p.filter((_, idx) => idx !== i))}
                  disabled={stages.length <= 1}
                  title="Remover aba"
                  className="shrink-0 rounded-lg border border-neutral-200 px-2.5 py-2 text-xs text-neutral-500 transition hover:border-red-300 hover:text-red-600 disabled:opacity-30"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setStages((p) => [...p, ""])}
            className="mt-2 rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 transition hover:border-neutral-500 hover:text-neutral-900"
          >
            + Adicionar aba
          </button>
        </div>

        <p className="text-xs text-neutral-500">
          Monte aqui todas as abas do funil. Você pode renomear ou adicionar novas depois.
        </p>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm">
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
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
  onAdd: (payload: { title: string; phone?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [phone, setPhone] = useState("");

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
      <div className="flex justify-end gap-2">
        <button onClick={() => setOpen(false)} className="rounded px-2 py-1 text-xs text-neutral-500">
          cancelar
        </button>
        <button
          onClick={() => {
            if (!title.trim()) return;
            onAdd({ title: title.trim(), phone: phone.trim() || undefined });
            setTitle("");
            setPhone("");
            setOpen(false);
          }}
          className="rounded bg-neutral-800 px-3 py-1 text-xs font-semibold text-white"
        >
          adicionar
        </button>
      </div>
    </div>
  );
}

