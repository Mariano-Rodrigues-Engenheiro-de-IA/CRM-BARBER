// Funis de vendas — kanbans customizáveis, manuais ou vindos de uma
// etiqueta do WhatsApp. Colunas e cards são criados pelo usuário; arrastar
// um card entre colunas grava a nova etapa no servidor.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatBRL,
  type Funnel,
  type FunnelCard,
  type WaContact,
  type WaLabel,
} from "@/lib/funnels";
import { isRealPhone, sendWaAction } from "@/lib/wa-actions";

type ApiFn = (path: string, opts?: RequestInit) => Promise<Record<string, unknown>>;

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900";

export function FunnelsView({ api }: { api: ApiFn }) {
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [labels, setLabels] = useState<WaLabel[]>([]);
  const [contacts, setContacts] = useState<WaContact[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const dragged = useRef<FunnelCard | null>(null);

  async function reload() {
    const [f, w] = await Promise.all([
      api("/api/public/extension/funnels"),
      api("/api/public/extension/wa/data"),
    ]);
    if (f?.ok) {
      const list = (f.funnels as Funnel[]) || [];
      setFunnels(list);
      setActiveId((cur) => cur ?? list[0]?.id ?? null);
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

  async function addCard(stageId: string, payload: { title: string; phone?: string; value_cents?: number; wa_contact_id?: string }) {
    if (!active) return;
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">Funis de vendas</h2>
          <p className="text-sm text-neutral-500">
            Crie funis próprios ou puxe uma etiqueta do WhatsApp e arraste os leads entre as etapas.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-yellow-400 hover:bg-neutral-800"
        >
          + Novo funil
        </button>
      </div>

      {err && <p className="text-sm text-red-500">{err}</p>}
      {loading && <p className="text-sm text-neutral-500">Carregando...</p>}

      {!loading && funnels.length === 0 && (
        <p className="text-sm text-neutral-500">
          Nenhum funil ainda. Crie o primeiro — as etiquetas do WhatsApp aparecem aqui após a
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
              {f.mode === "label" && <span className="ml-1 text-[10px] text-yellow-700">etiqueta</span>}
            </button>
          ))}
        </nav>
      )}

      {active && (
        <>
          <div className="flex items-center justify-between gap-2 text-xs text-neutral-500">
            <span>
              {active.cards.length} lead(s)
              {active.mode === "label" && ` · ${labelContacts.length} contato(s) nessa etiqueta`}
            </span>
            <button onClick={() => removeFunnel(active.id)} className="text-red-600 hover:underline">
              excluir funil
            </button>
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
                          <p className="text-sm font-medium text-neutral-900">{card.title}</p>
                          <button
                            onClick={() => removeCard(card)}
                            className="text-[11px] text-neutral-400 hover:text-red-600"
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
                        {isRealPhone(card.phone) && (
                          <button
                            onClick={() =>
                              void sendWaAction({ phone: card.phone!, name: card.title, openOnly: true })
                            }
                            className="mt-2 rounded-md border border-neutral-300 px-2 py-1 text-[11px] font-medium hover:bg-neutral-100"
                          >
                            Abrir no WhatsApp
                          </button>
                        )}
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

      {creating && (
        <NewFunnelModal
          labels={labels}
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

function NewFunnelModal({
  labels,
  onClose,
  onCreate,
}: {
  labels: WaLabel[];
  onClose: () => void;
  onCreate: (body: { name: string; mode: "manual" | "label"; source_label_id?: string | null; stages?: string[] }) => void;
}) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"manual" | "label">("manual");
  const [labelId, setLabelId] = useState("");
  const [stages, setStages] = useState("Novo lead, Em conversa, Negociando, Fechado");

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="mt-16 w-full max-w-lg rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-neutral-900">Novo funil</h3>
          <button onClick={onClose} className="rounded p-1 text-neutral-400 hover:text-neutral-900">
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-600">Nome do funil</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Ex.: Recuperação de inadimplentes" />
          </div>

          <div className="flex gap-2">
            {(["manual", "label"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={
                  "flex-1 rounded-lg border px-3 py-2 text-xs font-medium " +
                  (mode === m ? "border-neutral-900 bg-neutral-900 text-yellow-400" : "border-neutral-300")
                }
              >
                {m === "manual" ? "Funil manual" : "A partir de etiqueta"}
              </button>
            ))}
          </div>

          {mode === "label" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600">Etiqueta do WhatsApp</label>
              <select value={labelId} onChange={(e) => setLabelId(e.target.value)} className={inputCls}>
                <option value="">Selecione…</option>
                {labels.map((l) => (
                  <option key={l.id} value={l.wa_label_id}>
                    {l.name} ({l.conversation_count})
                  </option>
                ))}
              </select>
              {labels.length === 0 && (
                <p className="mt-1 text-[11px] text-neutral-500">
                  Nenhuma etiqueta sincronizada ainda — abra o WhatsApp Web com a extensão ativa.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-600">Colunas (separadas por vírgula)</label>
            <input value={stages} onChange={(e) => setStages(e.target.value)} className={inputCls} />
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm">
              Cancelar
            </button>
            <button
              onClick={() => {
                if (!name.trim()) return;
                onCreate({
                  name: name.trim(),
                  mode,
                  source_label_id: mode === "label" ? labelId || null : null,
                  stages: stages
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                });
              }}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-yellow-400"
            >
              Criar funil
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
