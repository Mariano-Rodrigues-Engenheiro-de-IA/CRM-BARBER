// Grupo do Kanban de leads do painel - cartões de lead, ações rápidas de
// WhatsApp, gaveta de detalhe do cliente, e os modais de adicionar/importar
// contatos. Extraído de painel.tsx pra reduzir o tamanho desse arquivo (era
// um dos 3 arquivos gigantes apontados na varredura de código morto/
// arquitetura).

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm-dialog";
import { sendableActions, type QuickReply } from "@/lib/quick-replies";
import { sendWaAction, isRealPhone, openWhatsappChat, applyFunnelActions } from "@/lib/wa-actions";
import { api } from "@/lib/painel-api";
import { IconClock, IconNote, IconWhatsapp } from "@/components/painel-icons";
import { formatBRL } from "@/lib/funnels";
import { readPlans, priceOf, mergeDetectedPlans, type Plan } from "@/lib/shop-settings";
import {
  planFromTags,
  parseSubscriptionSheet,
  SUBSCRIPTION_SYSTEMS,
  type SubscriptionSystemId,
} from "@/lib/subscription-systems";
import {
  type Customer,
  type Col,
  nudgeExtensionPoll,
  visibleColumns,
  writeColumns,
  readSystem,
  syncColumnsFromSheet,
} from "@/routes/painel";

type DrawerTab = "notes" | "schedule";



/** Botãozinho de ação rápida no card do lead. */
function CardAction({
  title,
  onClick,
  disabled,
  children,
  colorClass,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  colorClass?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      draggable={false}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={
        "grid h-7 w-7 place-items-center rounded-md transition disabled:opacity-40 " +
        (colorClass ?? "text-neutral-500 hover:text-brand")
      }
    >
      {children}
    </button>
  );
}

/** Planilhas sem coluna de telefone geram placeholder "sem-tel-..." — nunca mostrar cru. */
function phoneLabel(phone: string) {
  return isRealPhone(phone) ? phone : "Sem telefone cadastrado";
}

/** Abrir conversa / enviar resposta rápida ou mensagem manual pelo CRM. */
function WhatsAppActionModal({
  token,
  customer,
  onClose,
}: {
  token: string;
  customer: Customer;
  onClose: () => void;
}) {
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [phone, setPhone] = useState(isRealPhone(customer.phone) ? customer.phone : "");
  const [phoneDraft, setPhoneDraft] = useState("");

  useEffect(() => {
    api(token, "/api/public/extension/quick-replies").then((r) => {
      if (r?.ok) setReplies((r.quick_replies as QuickReply[]) || []);
    });
  }, [token]);

  /** Contato veio de planilha sem telefone: dá pra cadastrar aqui mesmo. */
  async function savePhone() {
    if (!phoneDraft.trim()) return;
    setBusy(true);
    setErr(null);
    const r = await api(token, `/api/public/extension/customers/${customer.id}`, {
      method: "PATCH",
      body: JSON.stringify({ phone: phoneDraft.trim() }),
    });
    setBusy(false);
    if (!r?.ok) {
      setErr(r?.error || "Não foi possível salvar o telefone");
      return;
    }
    setPhone(r.customer.phone as string);
    setPhoneDraft("");
    setFeedback("Telefone salvo ✔");
  }

  async function run(openOnly: boolean) {
    if (!isRealPhone(phone)) {
      setErr("Cadastre um telefone válido para este contato antes de enviar.");
      return;
    }
    setBusy(true);
    setErr(null);
    setFeedback(null);
    const qr = replies.find((q) => q.id === selected);
    const r = openOnly
      ? await openWhatsappChat(phone, customer.name)
      : await sendWaAction({
          phone,
          name: customer.name,
          text: text.trim() || undefined,
          actions: qr ? sendableActions(qr.actions) : undefined,
        });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error || "Falha ao falar com a extensão");
      return;
    }
    if (!openOnly && qr) {
      await applyFunnelActions((path, opts) => api(token, path, opts), qr.actions, {
        title: customer.name,
        phone,
      });
    }
    setFeedback(openOnly ? "Conversa aberta no WhatsApp ✔" : "Mensagem enviada ✔");
  }

  return (
    <Modal onClose={onClose} title={`WhatsApp: ${customer.name}`}>
      <div className="space-y-4">
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
          {isRealPhone(phone) ? (
            phone
          ) : (
            <div className="space-y-2">
              <p className="text-neutral-600">
                Este contato veio da planilha sem telefone. Cadastre para poder enviar.
              </p>
              <div className="flex gap-2">
                <input
                  value={phoneDraft}
                  onChange={(e) => setPhoneDraft(e.target.value)}
                  placeholder="(11) 91234-5678"
                  className={inputCls}
                />
                <button
                  onClick={savePhone}
                  disabled={busy || !phoneDraft.trim()}
                  className="whitespace-nowrap rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Salvar
                </button>
              </div>
            </div>
          )}
        </div>

        <Field label="Resposta rápida">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className={inputCls}
          >
            <option value="">Nenhuma (mensagem manual)</option>
            {replies.map((q) => (
              <option key={q.id} value={q.id}>
                {q.title}
              </option>
            ))}
          </select>
        </Field>

        {!selected && (
          <Field label="Mensagem">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="Oi {nome}, tudo certo?"
              className={inputCls}
            />
          </Field>
        )}

        {err && <p className="text-sm text-red-500">{err}</p>}
        {feedback && <p className="text-sm text-emerald-600">{feedback}</p>}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => run(true)}
            disabled={busy}
            className="flex-1 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
          >
            Abrir conversa
          </button>
          <button
            onClick={() => run(false)}
            disabled={busy || (!selected && !text.trim())}
            className="flex-1 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
          >
            {busy ? "Enviando..." : "Enviar agora"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function KanbanView({
  customers,
  loading,
  token,
  reload,
  shopId,
  headerHost,
  onGoSettings,
}: {
  customers: Customer[];
  loading: boolean;
  token: string;
  reload: () => void | Promise<void>;
  shopId: string;
  headerHost?: HTMLDivElement | null;
  onGoSettings: () => void;
}) {
  const { confirm, dialog } = useConfirm();
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [detail, setDetail] = useState<Customer | null>(null);
  const [detailTab, setDetailTab] = useState<DrawerTab>("notes");
  const [waTarget, setWaTarget] = useState<Customer | null>(null);

  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  // Move otimista: evita o card "voltar" enquanto o reload não chega.
  const [pending, setPending] = useState<Record<string, string>>({});
  const [plans, setPlans] = useState<Plan[]>([]);

  useEffect(() => {
    setPlans(readPlans(shopId));
  }, [shopId]);

  // Kanbans são flexíveis: o usuário cria e exclui colunas à vontade.
  const [cols, setCols] = useState<Col[]>(() => visibleColumns(shopId));
  const [newCol, setNewCol] = useState<string | null>(null);

  useEffect(() => {
    setCols(visibleColumns(shopId));
  }, [shopId, showImport]);

  function persistCols(next: Col[]) {
    setCols(next);
    writeColumns(shopId, next);
  }

  function addColumn(label: string) {
    const name = label.trim();
    if (!name) return;
    const key = `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    if (cols.some((c) => c.key === key)) return;
    persistCols([...cols, { key, label: name }]);
  }

  async function removeColumn(col: Col) {
    const contactCount = byStatus[col.key]?.length ?? 0;
    const ok = await confirm({
      title: `Excluir o kanban "${col.label}"?`,
      description:
        contactCount > 0
          ? `A coluna será excluída, mas os ${contactCount} contato(s) dentro dela continuarão salvos. Eles voltarão a aparecer se uma coluna com esse mesmo status for criada ou importada novamente.`
          : "A coluna será excluída. Nenhum contato será removido.",
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    persistCols(cols.filter((c) => c.key !== col.key));
  }

  const effective = useMemo(
    () => customers.map((c) => (pending[c.id] ? { ...c, status: pending[c.id] } : c)),
    [customers, pending],
  );

  const byStatus = useMemo(() => {
    const g: Record<string, Customer[]> = {};
    for (const col of cols) g[col.key] = [];
    for (const c of effective) {
      if (!g[c.status]) g[c.status] = [];
      g[c.status].push(c);
    }
    return g;
  }, [effective, cols]);

  const colTotal = (key: string) =>
    (byStatus[key] ?? []).reduce((sum, c) => sum + priceOf(plans, planFromTags(c.tags)), 0);

  async function moveTo(id: string, status: string) {
    setPending((p) => ({ ...p, [id]: status }));
    const r = await api(token, `/api/public/extension/customers/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    if (!r?.ok)
      setPending((p) => {
        const n = { ...p };
        delete n[id];
        return n;
      });
    reload();
  }

  async function remove(id: string) {
    const ok = await confirm({
      title: "Remover este contato do CRM?",
      description: "Ele fica arquivado no histórico e some dos funis.",
      confirmLabel: "Remover",
      destructive: true,
    });
    if (!ok) return;
    await api(token, `/api/public/extension/customers/${id}`, { method: "DELETE" });
    reload();
  }

  // Primeira utilização = sem kanbans e sem contatos: só oferecemos a importação.
  const firstUse = cols.length === 0 && customers.length === 0;

  // Barra de ações: vive no cabeçalho do topo (portal) pra não ocupar altura útil.
  const toolbar = firstUse ? null : (
    <div className="flex items-center gap-2">
      {newCol === null ? (
        <button
          onClick={() => setNewCol("")}
          title="Adicionar kanban"
          className="rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 shadow-sm transition hover:border-brand hover:bg-neutral-50"
        >
          + Kanban
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={newCol}
            onChange={(e) => setNewCol(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                addColumn(newCol);
                setNewCol(null);
              }
              if (e.key === "Escape") setNewCol(null);
            }}
            placeholder="Nome do kanban"
            className="w-44 rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-900 outline-none focus:border-brand"
          />
          <button
            onClick={() => {
              addColumn(newCol);
              setNewCol(null);
            }}
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white hover:bg-brand-strong"
          >
            Criar
          </button>
          <button
            onClick={() => setNewCol(null)}
            className="text-xs text-neutral-500 hover:text-neutral-900"
          >
            cancelar
          </button>
        </div>
      )}
      <button
        onClick={() => setShowAdd(true)}
        title="Adicionar contato"
        className="rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 shadow-sm transition hover:border-brand hover:bg-neutral-50"
      >
        + Contato
      </button>
      {/* Importar continua disponível pra sempre: reimportar sincroniza a planilha
          sem apagar contatos criados à mão. */}
      <button
        onClick={() => setShowImport(true)}
        className="rounded-lg bg-brand px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-brand-strong"
      >
        Importar planilha
      </button>
    </div>
  );

  return (
    <div className="space-y-3">
      {dialog}

      {headerHost && toolbar ? createPortal(toolbar, headerHost) : null}

      {/* Primeira utilização: só o botão de importar planilha. */}
      {firstUse
        ? !loading && (
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-6 py-14 text-center">
              <p className="text-base font-semibold text-neutral-900">
                Comece importando sua planilha
              </p>
              <p className="mx-auto mt-1 max-w-md text-xs text-neutral-500">
                Os assinantes são cadastrados automaticamente e os kanbans nascem com a mesma
                estrutura da planilha.
              </p>
              <button
                onClick={() => setShowImport(true)}
                className="mx-auto mt-6 rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-strong"
              >
                Importar planilha
              </button>
            </div>
          )
        : null}

      {loading && <p className="text-sm text-neutral-500">Carregando...</p>}

      {!loading && !firstUse && cols.length === 0 && (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center">
          <p className="text-sm font-medium text-neutral-800">Nenhum kanban ainda</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-neutral-500">
            Importe uma planilha (os kanbans são criados automaticamente com a mesma estrutura dela)
            ou crie os seus com “+ Kanban”.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {cols.map((col) => (
          <div
            key={col.key}
            onDragOver={(e) => {
              e.preventDefault();
              setOverCol(col.key);
            }}
            onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              setOverCol(null);
              const id = dragId || e.dataTransfer.getData("text/plain");
              setDragId(null);
              if (id) moveTo(id, col.key);
            }}
            className={
              "rounded-xl border bg-white shadow-sm transition " +
              (overCol === col.key
                ? "border-neutral-400 ring-2 ring-neutral-300/60"
                : "border-neutral-200")
            }
          >
            <div className="border-b border-neutral-200 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="truncate text-[11px] font-semibold uppercase tracking-wider text-neutral-700">
                  {col.label}
                </h3>
                <button
                  onClick={() => void removeColumn(col)}
                  title="Excluir kanban"
                  className="shrink-0 rounded p-0.5 text-neutral-300 transition hover:text-red-600"
                >
                  ✕
                </button>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[11px] text-neutral-500">
                  {byStatus[col.key]?.length ?? 0} contato(s)
                </p>
                <p className="text-xs font-semibold text-neutral-900">
                  {formatBRL(colTotal(col.key))}
                </p>
              </div>
            </div>

            <div className="h-[calc(100vh-150px)] min-h-[420px] space-y-2 overflow-y-auto p-2.5">
              {(byStatus[col.key] ?? []).map((c) => {
                const plan = planFromTags(c.tags);
                return (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={(e) => {
                      setDragId(c.id);
                      e.dataTransfer.setData("text/plain", c.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverCol(null);
                    }}
                    onClick={() => setDetail(c)}
                    className={
                      "select-none cursor-grab rounded-lg border border-neutral-300 bg-neutral-50 p-2.5 text-[13px] transition hover:-translate-y-0.5 hover:border-neutral-400 hover:shadow-md active:cursor-grabbing " +
                      (dragId === c.id ? "opacity-50" : "")
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-neutral-900">
                          {c.name || phoneLabel(c.phone)}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {plan && (
                            <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium text-yellow-800">
                              {plan} · {formatBRL(priceOf(plans, plan))}
                            </span>
                          )}
                          {c.notes && (
                            <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-700">
                              anotação
                            </span>
                          )}
                        </div>
                        {/* Ações rápidas no próprio card */}
                        <div className="mt-2 flex items-center gap-1">
                          <CardAction
                            title="Abrir WhatsApp / enviar resposta rápida"
                            onClick={() => setWaTarget(c)}
                            colorClass="text-emerald-600 hover:bg-emerald-50"
                          >
                            <IconWhatsapp />
                          </CardAction>
                          <CardAction
                            title="Anotações"
                            onClick={() => {
                              setDetailTab("notes");
                              setDetail(c);
                            }}
                            colorClass="text-sky-600 hover:bg-sky-50"
                          >
                            <IconNote />
                          </CardAction>
                          <CardAction
                            title="Mensagem agendada"
                            onClick={() => {
                              setDetailTab("schedule");
                              setDetail(c);
                            }}
                            colorClass="text-orange-600 hover:bg-orange-50"
                          >
                            <IconClock />
                          </CardAction>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(c.id);
                        }}
                        className="rounded-md p-1 text-neutral-400 transition hover:bg-red-50 hover:text-red-600"
                        title="Remover"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="14"
                          height="14"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M4 7h16" />
                          <path d="M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7" />
                          <path d="M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7" />
                          <path d="M10 11v6M14 11v6" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
              {(byStatus[col.key]?.length ?? 0) === 0 && (
                <p className="p-3 text-center text-xs text-neutral-400">Arraste um card para cá</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {showAdd && (
        <AddModal
          token={token}
          cols={cols}
          onClose={() => {
            setShowAdd(false);
            reload();
          }}
        />
      )}
      {waTarget && (
        <WhatsAppActionModal token={token} customer={waTarget} onClose={() => setWaTarget(null)} />
      )}
      {detail && (
        <CustomerDrawer
          token={token}
          customer={detail}
          plans={plans}
          cols={cols}
          initialTab={detailTab}
          onOpenWhatsapp={() => {
            setWaTarget(detail);
            setDetail(null);
          }}
          onMove={(status) => {
            moveTo(detail.id, status);
            setDetail(null);
          }}
          onClose={() => {
            setDetail(null);
            reload();
          }}
        />
      )}

      {showImport && (
        <ImportModal
          token={token}
          shopId={shopId}
          system={readSystem(shopId)}
          onGoSettings={() => {
            setShowImport(false);
            onGoSettings();
          }}
          onImported={async (summary) => {
            // Sucesso: fecha o pop-up na hora e a lista já aparece atualizada.
            setShowImport(false);
            setPending({});
            setPlans(readPlans(shopId));
            setCols(visibleColumns(shopId));
            await reload();
            toast.success("Planilha importada", { description: summary });
          }}
          onClose={() => {
            setShowImport(false);
            setPending({});
            setPlans(readPlans(shopId));
            setCols(visibleColumns(shopId));
            reload();
          }}
        />
      )}
    </div>
  );
}

/** Pipeline do assinante: anotações + mensagem agendada. */
function CustomerDrawer({
  token,
  customer,
  plans,
  cols,
  initialTab = "notes",
  onOpenWhatsapp,
  onMove,
  onClose,
}: {
  token: string;
  customer: Customer;
  plans: Plan[];
  cols: Array<{ key: string; label: string }>;
  initialTab?: DrawerTab;
  onOpenWhatsapp?: () => void;
  onMove: (status: string) => void;
  onClose: () => void;
}) {
  const plan = planFromTags(customer.tags);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>(initialTab);
  const [notes, setNotes] = useState(customer.notes ?? "");
  const [savedNotes, setSavedNotes] = useState(false);
  const [msg, setMsg] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function saveNotes() {
    setBusy(true);
    const r = await api(token, `/api/public/extension/customers/${customer.id}`, {
      method: "PATCH",
      body: JSON.stringify({ notes: notes.trim() || null }),
    });
    setBusy(false);
    if (!r?.ok) {
      setErr(r?.error || "Erro ao salvar anotação");
      return;
    }
    setErr(null);
    setSavedNotes(true);
    setTimeout(() => setSavedNotes(false), 1800);
  }

  async function schedule() {
    if (!msg.trim()) return;
    setBusy(true);
    setErr(null);
    const r = await api(token, "/api/public/extension/campaigns", {
      method: "POST",
      body: JSON.stringify({
        name: `Mensagem: ${customer.name}`,
        message: msg.trim(),
        customer_ids: [customer.id],
        scheduled_for: when ? new Date(when).toISOString() : undefined,
      }),
    });
    setBusy(false);
    if (!r?.ok) {
      setErr(r?.error || "Erro ao agendar");
      return;
    }
    setMsg("");
    setFeedback(when ? "Mensagem agendada ✔" : "Mensagem enfileirada para envio ✔");
    nudgeExtensionPoll();
  }

  return (
    <Modal onClose={onClose} title={customer.name}>
      <div className="space-y-4">
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
          <div>{phoneLabel(customer.phone)}</div>
          {plan && (
            <div className="mt-1">
              Plano: <strong>{plan}</strong> · {formatBRL(priceOf(plans, plan))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-neutral-100 p-1">
            {(["notes", "schedule"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setDrawerTab(t)}
                className={
                  "rounded-md px-3 py-1.5 text-xs font-medium transition " +
                  (drawerTab === t
                    ? "bg-white text-neutral-900 shadow-sm"
                    : "text-neutral-500 hover:text-neutral-900")
                }
              >
                {t === "notes" ? "Anotações" : "Mensagens agendadas"}
              </button>
            ))}
          </div>
          {onOpenWhatsapp && (
            <button
              onClick={onOpenWhatsapp}
              className="ml-auto flex items-center gap-1.5 rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
            >
              <IconWhatsapp /> WhatsApp
            </button>
          )}
        </div>

        <Field label="Etapa do funil">
          <select
            value={customer.status}
            onChange={(e) => onMove(e.target.value)}
            className={inputCls}
          >
            {cols.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>

        {drawerTab === "notes" && (
          <>
            <Field label="Anotações">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                maxLength={1000}
                placeholder="Histórico, combinados, motivo do atraso..."
                className={inputCls}
              />
            </Field>
            <div className="flex items-center gap-3">
              <button
                onClick={saveNotes}
                disabled={busy}
                className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
              >
                Salvar anotação
              </button>
              {savedNotes && <span className="text-xs font-medium text-emerald-600">Salvo ✔</span>}
            </div>
          </>
        )}

        {drawerTab === "schedule" && (
          <>
            <Field label="Mensagem para disparo">
              <textarea
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                rows={3}
                maxLength={4000}
                placeholder="Oi {nome}, sua mensalidade..."
                className={inputCls}
              />
            </Field>
            <Field label="Agendar para (vazio = enviar agora)">
              <input
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className={inputCls}
              />
            </Field>
            <button
              onClick={schedule}
              disabled={busy || !msg.trim()}
              className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
            >
              {busy ? "Enviando..." : when ? "Agendar mensagem" : "Enviar mensagem"}
            </button>
          </>
        )}

        {err && <p className="text-sm text-red-500">{err}</p>}
        {feedback && <p className="text-sm text-emerald-600">{feedback}</p>}
      </div>
    </Modal>
  );
}

function AddModal({
  token,
  cols,
  onClose,
}: {
  token: string;
  cols: Array<{ key: string; label: string }>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  // A coluna precisa existir no kanban — senão o contato some da tela.
  const [status, setStatus] = useState(cols[0]?.key ?? "active");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;
    setBusy(true);
    setErr(null);
    const r = await api(token, "/api/public/extension/customers", {
      method: "POST",
      body: JSON.stringify({
        name: name.trim(),
        phone: phone.trim(),
        status,
        tags: [],
        is_subscriber: true,
      }),
    });
    setBusy(false);
    if (!r?.ok) {
      setErr(r?.error || "Erro");
      return;
    }
    onClose();
  }

  return (
    <Modal onClose={onClose} title="Adicionar contato">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Nome">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
            required
          />
        </Field>
        <Field label="Telefone (com DDD)">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={inputCls}
            required
          />
        </Field>
        <Field label="Coluna">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
            {cols.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        {err && <p className="text-sm text-red-500">{err}</p>}
        <button
          disabled={busy}
          className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
        >
          {busy ? "Salvando..." : "Adicionar"}
        </button>
      </form>
    </Modal>
  );
}

async function sheetToMatrix(file: File): Promise<string[][]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, blankrows: false, defval: "" });
  return rows.map((r) => (r as unknown[]).map((c) => String(c ?? "")));
}

function ImportModal({
  token,
  shopId,
  onClose,
  onImported,
  system,
  onGoSettings,
}: {
  token: string;
  shopId: string;
  onClose: () => void;
  /** Importou com sucesso: o modal fecha sozinho e a tela já mostra os contatos. */
  onImported: (summary: string) => void;
  system: SubscriptionSystemId | null;
  onGoSettings: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const meta = SUBSCRIPTION_SYSTEMS.find((s) => s.id === system);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !system) return;
    setBusy(true);
    setErr(null);
    try {
      const matrix = await sheetToMatrix(file);
      const report = parseSubscriptionSheet(system, matrix);
      if (!report.rows.length) {
        throw new Error(
          "Nenhuma linha válida encontrada. Confira se a planilha é a exportação do " +
            (meta?.label ?? "sistema") +
            " e tem colunas de nome e telefone.",
        );
      }
      const r = await api(token, "/api/public/extension/customers/import", {
        method: "POST",
        body: JSON.stringify({
          customers: report.rows,
          mode: "replace_spreadsheet",
          is_subscriber: true,
        }),
      });
      if (!r?.ok) throw new Error(r?.error || "Erro na importação");

      // Planos detectados na planilha entram no catálogo (valor a definir).
      const detected = Object.keys(report.byPlan);
      const merged = mergeDetectedPlans(shopId, detected);
      const semValor = merged.filter((p) => p.priceCents <= 0).length;

      const semTelefone = report.rows.filter((r) => r.tags.includes("sem-telefone")).length;

      // Os kanbans passam a espelhar a estrutura da planilha importada.
      const sheetStatuses = Object.keys(report.byStatus);
      const syncedCols = syncColumnsFromSheet(shopId, sheetStatuses);

      const dist = syncedCols.map((c) => `${c.label}: ${report.byStatus[c.key]}`).join(" · ");

      onImported(
        `Linhas lidas: ${report.total} · Importadas: ${report.rows.length}` +
          (report.skipped ? ` · Ignoradas (sem telefone/status): ${report.skipped}` : "") +
          `\nNovos: ${r.inserted} · Atualizados: ${r.updated}` +
          (r.archived ? ` · Removidos da planilha antiga: ${r.archived}` : "") +
          (dist ? `\n${dist}` : "") +
          (detected.length ? `\nPlanos detectados: ${detected.join(" · ")}` : "") +
          (semValor ? `\n${semValor} plano(s) sem valor. Cadastre em Configurações.` : "") +
          (semTelefone
            ? `\n${semTelefone} assinante(s) sem telefone na planilha. Entram no Kanban, mas ficam fora dos disparos.`
            : "") +
          (report.unmappedStatuses.length
            ? `\nStatus não reconhecidos (usei a data de vencimento): ${report.unmappedStatuses.join(", ")}`
            : ""),
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!system) {
    return (
      <Modal onClose={onClose} title="Importar planilha">
        <div className="space-y-4">
          <p className="text-sm text-neutral-700">
            Escolha em <strong>Configurações</strong> o sistema de assinatura da barbearia.
          </p>
          <button
            onClick={onGoSettings}
            className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong"
          >
            Ir para Configurações
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} title={`Importar planilha: ${meta?.label ?? ""}`}>
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
          {meta?.hint}
        </div>

        <Field label="Arquivo (.xlsx ou .csv)">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv,.tsv,.txt"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="hidden"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
            >
              Escolher arquivo
            </button>
            <span className="truncate text-xs text-neutral-500">
              {file ? file.name : "Nenhum arquivo selecionado"}
            </span>
          </div>
        </Field>

        {err && <p className="text-sm text-red-500">{err}</p>}
        <button
          disabled={busy || !file}
          className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
        >
          {busy ? "Importando..." : "Importar e organizar"}
        </button>
      </form>
    </Modal>
  );
}

// O formulário de disparo agora vive na seção "Disparo" (src/components/dispatch-view.tsx).

// Cache module-scoped: sobrevive à troca de aba, evita "Carregando..." piscando.

// --- Utils ---

export const inputCls =
  "w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-neutral-700">{label}</span>
      {children}
    </label>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl border border-neutral-300 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
