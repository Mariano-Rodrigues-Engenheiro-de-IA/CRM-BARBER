// Funis de vendas — kanbans customizáveis criados de três formas:
//   • Aba        → também aparece como aba no topo do WhatsApp Web
//   • Listas     → alimentado por uma lista (etiqueta) nativa do WhatsApp
//   • Novo funil → colunas e leads montados manualmente
//
// Os cards seguem o mesmo padrão dos kanbans de assinaturas:
// anotações, mensagem agendada e disparo/abrir conversa no WhatsApp.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Clock } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm-dialog";
import {
  formatBRL,
  type Funnel,
  type FunnelCard,
  type FunnelMode,
  type WaContact,
  type WaLabel,
} from "@/lib/funnels";
import { applyFunnelActions, canOpenWhatsapp, openWhatsappChat } from "@/lib/wa-actions";
import { ensureDefaultFunnels, syncLabelFunnel } from "@/lib/label-funnel-sync";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { sendableActions, type QuickReply } from "@/lib/quick-replies";
import {
  IconWhatsapp,
  IconNote,
  IconClock,
  IconScissors,
  IconProfile,
  IconDeal,
  IconTrashMini,
  IconPencilMini,
  IconTag,
} from "@/components/painel-icons";
import { CardDrawer } from "@/components/funnels-card-drawer";
import {
  StageTitle,
  DotsMenu,
  FunnelPicker,
  FollowupBadge,
  UnreadBadge,
  NotesBadge,
  CardAction,
  Overlay,
  BulkMoveModal,
  NewFunnelModal,
  AddStageColumn,
} from "@/components/funnels-helpers";

export type ApiFn = (path: string, opts?: RequestInit) => Promise<Record<string, unknown>>;

export const inputCls =
  "w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-brand";

/** Cache entre navegações: voltar pra aba Funis não deve piscar esqueleto. */
let funnelsCache: { funnels: Funnel[]; labels: WaLabel[]; contacts: WaContact[] } | null = null;

export function FunnelsView({
  api,
  headerHost,
  premiumLocked,
  onBlockedMove,
}: {
  api: ApiFn;
  headerHost?: HTMLElement | null;
  /** Conta grátis: os leads e funis existentes aparecem normal (nada de
   * prévia falsa), só a ação de MOVER um lead entre etapas/funis é
   * bloqueada — dispara onBlockedMove em vez de mover de verdade. */
  premiumLocked?: boolean;
  onBlockedMove?: () => void;
}) {
  const [funnels, setFunnels] = useState<Funnel[]>(() => funnelsCache?.funnels ?? []);
  const [labels, setLabels] = useState<WaLabel[]>(() => funnelsCache?.labels ?? []);
  const [contacts, setContacts] = useState<WaContact[]>(() => funnelsCache?.contacts ?? []);
  const [activeId, setActiveId] = useState<string | null>(
    () => funnelsCache?.funnels[0]?.id ?? null,
  );
  const [loading, setLoading] = useState(!funnelsCache);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const markingAttendanceRef = useRef<Set<string>>(new Set());

  async function handleMarkAttendance(card: {
    phone: string | null;
    title: string;
    wa_contact_id?: string | null;
  }) {
    if (!card.phone) {
      toast.error("Esse lead não tem telefone, não dá pra marcar atendimento.");
      return;
    }
    // Trava contra clique duplo/repetido enquanto a chamada anterior
    // pra esse mesmo telefone ainda está em andamento.
    if (markingAttendanceRef.current.has(card.phone)) return;
    const ok = await confirm({
      title: "Marcar atendimento?",
      description: `Confirma que ${card.title || card.phone} foi atendido agora? Ele vai entrar na aba Pós-venda.`,
      confirmLabel: "Marcar",
    });
    if (!ok) return;
    if (markingAttendanceRef.current.has(card.phone)) return;
    markingAttendanceRef.current.add(card.phone);
    try {
      const r = await api("/api/public/extension/mark-attendance", {
        method: "POST",
        body: JSON.stringify({
          phone: card.phone,
          title: card.title,
          wa_contact_id: card.wa_contact_id || undefined,
        }),
      });
      if (r?.ok) {
        toast.success("Atendimento marcado.");
      } else {
        toast.error((r?.error as string) || "Não consegui marcar o atendimento.");
      }
    } finally {
      markingAttendanceRef.current.delete(card.phone);
    }
  }
  const [detail, setDetail] = useState<FunnelCard | null>(null);
  const [bulkMoveTarget, setBulkMoveTarget] = useState<{
    stageId: string;
    stageName: string;
  } | null>(null);
  const [bulkMoving, setBulkMoving] = useState(false);
  const [detailTab, setDetailTab] = useState<"notes" | "schedule" | "profile">("notes");
  const [inboxQuery, setInboxQuery] = useState("");
  const [renamingStage, setRenamingStage] = useState<string | null>(null);
  const [stageSearch, setStageSearch] = useState<Record<string, string>>({});
  const [dropIndicator, setDropIndicator] = useState<{ stageId: string; index: number } | null>(
    null,
  );
  const draggedCardHeight = useRef<number>(72);
  const [stageDropIndicator, setStageDropIndicator] = useState<number | null>(null);
  // Valor do cliente somado — carregado uma vez, em lote, pra mostrar tanto
  // o valor individual em cada card quanto o total parado em cada etapa.
  const [dealValues, setDealValues] = useState<
    Array<{ wa_contact_id: string | null; phone: string | null; value_cents: number | null }>
  >([]);
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  // Snapshot ESTÁTICO das posições dos cards de uma coluna, capturado uma
  // única vez ao entrar nela durante o arraste — evita o loop de
  // realimentação onde re-medir o DOM a cada movimento (que a própria
  // inserção do placeholder já alterou) causava o card "trocar de alvo"
  // continuamente e tremer.
  const columnSnapshot = useRef<{ stageId: string; cards: { id: string; mid: number }[] } | null>(
    null,
  );
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  /** Só atualiza o indicador se a posição realmente mudou — evita
   * re-renders/flicker a cada pixel de movimento do mouse. */
  function setDropIndicatorStable(next: { stageId: string; index: number } | null) {
    setDropIndicator((prev) => {
      if (prev?.stageId === next?.stageId && prev?.index === next?.index) return prev;
      return next;
    });
  }
  const dragged = useRef<FunnelCard | null>(null);
  const draggedContact = useRef<WaContact | null>(null);
  const draggedStageId = useRef<string | null>(null);
  const pendingContacts = useRef<Set<string>>(new Set());

  async function reload() {
    const [f, w] = await Promise.all([
      api("/api/public/extension/funnels?include_attendance=1"),
      api("/api/public/extension/wa/data"),
    ]);
    let list: Funnel[] = funnelsCache?.funnels ?? [];
    if (f?.ok) {
      list = (f.funnels as Funnel[]) || [];
      setFunnels(list);
      setActiveId((cur) => (cur && list.some((x) => x.id === cur) ? cur : (list[0]?.id ?? null)));
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
    return { list, labels: ls, contacts: cs };
  }

  useEffect(() => {
    void (async () => {
      const r = await reload();
      if (!r) return;
      const created = await ensureDefaultFunnels(api, r.list);
      const base = created ? await reload() : r;
      if (await syncLabelFunnel(api, base.list, base.labels)) await reload();
    })();
    api("/api/public/extension/customer-deal").then((r) => {
      if (r?.ok) setDealValues((r.deals as typeof dealValues) || []);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dealValueByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of dealValues) {
      const key = d.wa_contact_id || d.phone;
      if (!key || d.value_cents == null) continue;
      map.set(key, (map.get(key) || 0) + d.value_cents);
    }
    return map;
  }, [dealValues]);

  function stageTotalValue(stageId: string): number {
    const cards = active?.cards.filter((c) => c.stage_id === stageId) ?? [];
    return cards.reduce(
      (sum, c) => sum + (dealValueByKey.get(c.wa_contact_id || c.phone || "") || 0),
      0,
    );
  }

  const active = funnels.find((f) => f.id === activeId) || null;

  const inboxContacts = useMemo(() => {
    // Um contato que já virou lead em QUALQUER funil não deve mais
    // aparecer no Inbox — antes só filtrava grupos, deixando o contato
    // "duplicado" (visível no Inbox e já dentro de uma etapa do funil).
    const contactIdsInFunnels = new Set(
      funnels.flatMap((f) => f.cards.map((c) => c.wa_contact_id).filter(Boolean)),
    );
    return contacts.filter((c) => !c.is_group && !contactIdsInFunnels.has(c.id));
  }, [contacts, funnels]);

  function stageCards(stageId: string): FunnelCard[] {
    if (!active || active.mode !== "label")
      return (active?.cards.filter((c) => c.stage_id === stageId) ?? []).sort(
        (a, b) => a.sort_order - b.sort_order,
      );
    const stage = active.stages.find((item) => item.id === stageId);
    const label = labels.find((item) => item.name === stage?.name);
    if (!label) return [];
    return contacts
      .filter((contact) => !contact.is_group && contact.label_ids.includes(label.wa_label_id))
      .map((contact, index) => ({
        id: `wa-${stageId}-${contact.id}`,
        funnel_id: active.id,
        stage_id: stageId,
        title: contact.name || contact.phone || contact.wa_id,
        phone: contact.phone,
        value_cents: null,
        notes: null,
        sort_order: index,
        customer_id: null,
        wa_contact_id: contact.id,
        wa_id: contact.wa_id,
        label_ids: contact.label_ids,
        profile_picture_url: contact.profile_picture_url ?? null,
        unread_count: contact.unread_count ?? 0,
      }));
  }

  async function moveCard(card: FunnelCard, stageId: string) {
    if (card.stage_id === stageId) return;
    if (premiumLocked) {
      onBlockedMove?.();
      return;
    }
    setFunnels((list) =>
      list.map((f) =>
        f.id !== card.funnel_id
          ? f
          : {
              ...f,
              cards: f.cards.map((c) => (c.id === card.id ? { ...c, stage_id: stageId } : c)),
            },
      ),
    );
    const r = await api("/api/public/extension/funnel-cards", {
      method: "PATCH",
      body: JSON.stringify({ id: card.id, stage_id: stageId }),
    });
    if (!r?.ok) void reload();
  }

  /** Move o card pra uma posição EXATA dentro da coluna de destino (usado
   * pelo indicador visual de posição durante o arraste) — recalcula o
   * sort_order de todos os cards afetados na coluna de destino. */
  async function moveCardToPosition(card: FunnelCard, stageId: string, targetIndex: number) {
    if (!active) return;
    if (premiumLocked) {
      onBlockedMove?.();
      return;
    }
    const funnelId = card.funnel_id;
    const destCardsBefore = active.cards
      .filter((c) => c.stage_id === stageId && c.id !== card.id)
      .sort((a, b) => a.sort_order - b.sort_order);
    const newDestOrder = [...destCardsBefore];
    const clampedIndex = Math.max(0, Math.min(targetIndex, newDestOrder.length));
    newDestOrder.splice(clampedIndex, 0, card);
    const withNewOrder = newDestOrder.map((c, i) => ({ ...c, stage_id: stageId, sort_order: i }));

    setFunnels((list) =>
      list.map((f) => {
        if (f.id !== funnelId) return f;
        const byId = new Map(withNewOrder.map((c) => [c.id, c]));
        return { ...f, cards: f.cards.map((c) => byId.get(c.id) ?? c) };
      }),
    );

    await Promise.all(
      withNewOrder.map((c) =>
        api("/api/public/extension/funnel-cards", {
          method: "PATCH",
          body: JSON.stringify({
            id: c.id,
            sort_order: c.sort_order,
            // Só manda stage_id pro card que REALMENTE mudou de etapa — os
            // outros só estão sendo reordenados dentro da mesma coluna
            // (arrastou um card por cima deles), não é uma entrada nova
            // na etapa. Sem essa distinção, TODO card da coluna de
            // destino tinha o tempo de follow-up resetado a cada
            // arraste, mesmo os que já estavam lá parados.
            ...(c.id === card.id ? { stage_id: c.stage_id } : {}),
          }),
        }),
      ),
    );
  }

  async function removeCard(card: FunnelCard) {
    setFunnels((list) =>
      list.map((f) =>
        f.id === card.funnel_id ? { ...f, cards: f.cards.filter((c) => c.id !== card.id) } : f,
      ),
    );
    await api("/api/public/extension/funnel-cards", {
      method: "DELETE",
      body: JSON.stringify({ id: card.id }),
    });
  }

  /** Mover em massa: pega TODOS os leads de uma etapa de origem (de
   * qualquer outro funil) e move um por um pra etapa de destino no funil
   * atual — sequencial (não Promise.all) de propósito, pra não disparar
   * dezenas de requisições simultâneas se a coluna de origem tiver muitos
   * leads. Faz as chamadas de API direto aqui (sem passar por um
   * setFunnels por card) e só recarrega tudo no final — atualizar o
   * estado a cada card, no meio de um loop assíncrono longo, arriscava
   * competir com outras coisas reagindo à mudança de `funnels` a cada
   * passo (era isso que fazia só o primeiro lead mover de verdade).
   */
  async function bulkMoveLeads(
    sourceFunnelId: string,
    sourceStageId: string,
    targetStageId: string,
  ) {
    if (!active) return;
    if (premiumLocked) {
      onBlockedMove?.();
      return;
    }
    const sourceFunnel = funnels.find((f) => f.id === sourceFunnelId);
    const cardsToMove = (sourceFunnel?.cards ?? []).filter((c) => c.stage_id === sourceStageId);
    if (!cardsToMove.length) return;
    setBulkMoving(true);
    const targetFunnelId = active.id;
    let moved = 0;
    for (const card of cardsToMove) {
      const r = await api("/api/public/extension/funnel-cards", {
        method: "POST",
        body: JSON.stringify({
          funnel_id: targetFunnelId,
          stage_id: targetStageId,
          title: card.title,
          phone: card.phone ?? undefined,
          wa_contact_id: card.wa_contact_id ?? undefined,
          wa_id: card.wa_id ?? undefined,
        }),
      });
      if (r?.ok) {
        await api("/api/public/extension/funnel-cards", {
          method: "DELETE",
          body: JSON.stringify({ id: card.id }),
        });
        moved += 1;
      } else {
        setErr((r?.error as string) || `Erro ao mover "${card.title}".`);
      }
    }
    setBulkMoving(false);
    setBulkMoveTarget(null);
    await reload();
    return moved;
  }

  async function addCard(
    stageId: string | undefined,
    payload: {
      title: string;
      phone?: string;
      wa_contact_id?: string;
      wa_id?: string;
      label_ids?: string[];
      unread_count?: number;
    },
    targetIndex?: number,
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
                  wa_id: payload.wa_id ?? null,
                  label_ids: payload.label_ids ?? [],
                  unread_count: payload.unread_count ?? 0,
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
          f.id !== funnelId
            ? f
            : { ...f, cards: f.cards.map((c) => (c.id === tempId ? created : c)) },
        ),
      );
      // Se veio de um drop numa posição específica (não o final da lista),
      // reaproveita a mesma lógica de reposicionamento já usada para mover
      // cards entre etapas — dá o mesmo comportamento de "abrir espaço"
      // também para leads chegando do Inbox, não só entre etapas do funil.
      if (targetIndex !== undefined) {
        await moveCardToPosition(created, stageId, targetIndex);
      }
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
      wa_id: c.wa_id,
      label_ids: c.label_ids,
      unread_count: c.unread_count,
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
  async function renameStage(
    stage: { id: string; name: string; sort_order: number },
    name: string,
  ) {
    if (!active || !name.trim() || name.trim() === stage.name) return;
    const funnelId = active.id;
    setFunnels((list) =>
      list.map((f) =>
        f.id !== funnelId
          ? f
          : {
              ...f,
              stages: f.stages.map((s) => (s.id === stage.id ? { ...s, name: name.trim() } : s)),
            },
      ),
    );
    await api(`/api/public/extension/funnels/${funnelId}`, {
      method: "PATCH",
      body: JSON.stringify({
        stages: [{ id: stage.id, name: name.trim(), sort_order: stage.sort_order }],
      }),
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

  /** Move uma coluna (estágio) pra posição de outra — recalcula o
   * sort_order de todas as colunas do funil ativo e manda pro backend
   * de uma vez (endpoint já suporta isso, sem precisar de nada novo). */
  async function reorderStagesToIndex(fromStageId: string, targetIndex: number) {
    if (!active) return;
    const funnelId = active.id;
    const ordered = [...active.stages].sort((a, b) => a.sort_order - b.sort_order);
    const fromIdx = ordered.findIndex((s) => s.id === fromStageId);
    if (fromIdx === -1) return;
    const [moved] = ordered.splice(fromIdx, 1);
    const clampedIndex = Math.max(0, Math.min(targetIndex, ordered.length));
    ordered.splice(clampedIndex, 0, moved);
    const withNewOrder = ordered.map((s, i) => ({ ...s, sort_order: i }));

    setFunnels((list) => list.map((f) => (f.id !== funnelId ? f : { ...f, stages: withNewOrder })));
    await api(`/api/public/extension/funnels/${funnelId}`, {
      method: "PATCH",
      body: JSON.stringify({
        stages: withNewOrder.map((s) => ({ id: s.id, name: s.name, sort_order: s.sort_order })),
      }),
    });
  }

  /** Adiciona uma nova coluna (estágio) no final do funil ativo. */
  async function addStage(name: string) {
    if (!active || !name.trim()) return;
    const funnelId = active.id;
    const nextOrder = active.stages.length
      ? Math.max(...active.stages.map((s) => s.sort_order)) + 1
      : 0;
    await api(`/api/public/extension/funnels/${funnelId}`, {
      method: "PATCH",
      body: JSON.stringify({ stages: [{ name: name.trim(), sort_order: nextOrder }] }),
    });
    await reload();
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
        className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white transition hover:bg-brand-strong"
      >
        Novo funil
      </button>
    </>
  );

  return (
    <div className="space-y-3">
      {confirmDialog}
      {headerHost ? (
        createPortal(header, headerHost)
      ) : (
        <div className="flex items-center gap-2">{header}</div>
      )}

      {err && <p className="text-sm text-red-500">{err}</p>}

      {loading && (
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[calc(100vh-108px)] w-72 shrink-0 animate-pulse rounded-xl border border-neutral-300 bg-[#eef0f1]"
            />
          ))}
        </div>
      )}

      {!loading && funnels.length === 0 && (
        <p className="text-sm text-neutral-500">Nenhum funil ainda. Use “Criar” para começar.</p>
      )}

      {active && (
        <>
          <div className="thin-scrollbar flex min-h-[calc(100vh-108px)] items-start gap-2.5 overflow-x-auto pb-4">
            <div
              className="flex max-h-[calc(100vh-108px)] w-72 shrink-0 flex-col rounded-xl border border-neutral-300 bg-[#eef0f1] py-2 pl-2 pr-1"
              style={{ borderTop: "4px solid #3d5fa8", borderBottom: "4px solid #3d5fa8" }}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-900">
                  Inbox
                </h3>
                <span className="shrink-0 rounded-full bg-neutral-200 px-2.5 py-1 text-xs font-bold text-neutral-700">
                  {inboxContacts.length}
                </span>
              </div>
              <div className="relative mt-1.5">
                <svg
                  viewBox="0 0 24 24"
                  width="13"
                  height="13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  value={inboxQuery}
                  onChange={(e) => setInboxQuery(e.target.value)}
                  placeholder="Buscar nesta aba..."
                  className="w-full rounded-lg border border-neutral-300 bg-white py-1.5 pl-7 pr-2 text-xs outline-none focus:border-brand"
                />
              </div>
              <div className="thin-scrollbar mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
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
                      onDragStart={(e) => {
                        draggedContact.current = c;
                        dragged.current = null;
                        draggedCardHeight.current = e.currentTarget.getBoundingClientRect().height;
                        // Sem payload no dataTransfer o Chrome cancela o drag
                        // iniciado dentro de containers com scroll/botões.
                        e.dataTransfer.effectAllowed = "move";
                        try {
                          e.dataTransfer.setData("text/plain", c.id);
                        } catch {
                          /* alguns navegadores bloqueiam tipos custom */
                        }
                      }}
                      onDragEnd={() => {
                        draggedContact.current = null;
                        setDropIndicator(null);
                        columnSnapshot.current = null;
                      }}

                      className="select-none cursor-move outline-none rounded-xl border border-neutral-300 bg-white p-3 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-neutral-400 hover:shadow-md active:cursor-move"
                    >
                      <div className="flex items-center gap-2 min-w-0 mb-1">
                        {c.profile_picture_url ? (
                          <Avatar className="h-7 w-7 shrink-0">
                            <AvatarImage src={c.profile_picture_url} alt={c.name || ""} />
                            <AvatarFallback className="text-[10px]">
                              {(c.name || c.phone || "??").slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        ) : (
                          <div className="h-7 w-7 shrink-0 rounded-full bg-neutral-100 flex items-center justify-center text-[10px] text-neutral-400 font-bold">
                            {(c.name || c.phone || "??").slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <p className="truncate text-sm font-medium text-neutral-900">
                          {c.name || c.phone || c.wa_id}
                        </p>
                      </div>
                      <div className="mt-2 flex items-center gap-1">
                        <div className="relative inline-block">
                          <CardAction
                            title="Abrir conversa no WhatsApp"
                            disabled={!canOpenWhatsapp(c.phone, c.wa_id)}
                            colorClass="text-emerald-600 hover:bg-emerald-50"
                            onClick={() =>
                              void openWhatsappChat(c.phone || "", c.name || undefined, c.wa_id)
                            }
                          >
                            <IconWhatsapp />
                          </CardAction>
                          <UnreadBadge count={c.unread_count} />
                        </div>
                        <CardAction
                          title="Anotações"
                          colorClass="text-sky-600 hover:bg-sky-50"
                          onClick={() => void promoteContact(c, "notes")}
                        >
                          <IconNote />
                        </CardAction>
                        <CardAction
                          title="Mensagem agendada / disparo"
                          colorClass="text-orange-600 hover:bg-orange-50"
                          onClick={() => void promoteContact(c, "schedule")}
                        >
                          <IconClock />
                        </CardAction>
                        {c.label_ids && c.label_ids.length > 0 ? (
                          c.label_ids.map((labelId) => {
                            const lbl = labels.find((l) => l.wa_label_id === labelId);
                            if (!lbl) return null;
                            return <IconTag key={labelId} color={lbl.color} title={lbl.name} />;
                          })
                        ) : (
                          <IconTag color={null} title="Sem etiqueta" />
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {active.stages.flatMap((stage, stageIndex) => {
              const allCards = stageCards(stage.id);
              const search = (stageSearch[stage.id] ?? "").trim().toLowerCase();
              const cards = search
                ? allCards.filter(
                    (c) =>
                      (c.title ?? "").toLowerCase().includes(search) ||
                      (c.phone ?? "").includes(search),
                  )
                : allCards;

              const stagePlaceholder =
                stageDropIndicator === stageIndex ? (
                  <div
                    key={`stage-indicator-${stage.id}`}
                    className="h-fit w-1 shrink-0 self-stretch rounded-full bg-brand/60 transition-all duration-150"
                  />
                ) : null;

              const columnEl = (
                <div
                  key={stage.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (draggedStageId.current) {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const isLeftHalf = e.clientX - rect.left < rect.width / 2;
                      setStageDropIndicator(isLeftHalf ? stageIndex : stageIndex + 1);
                      return;
                    }
                    if (dragged.current || draggedContact.current) {
                      const draggedId = dragged.current?.id;
                      // Captura a "foto" das posições dos cards só UMA VEZ ao
                      // entrar nessa coluna — os cálculos seguintes usam essa
                      // referência fixa, nunca o DOM ao vivo (que a inserção
                      // do próprio placeholder já alterou), eliminando o loop
                      // onde o alvo trocava a cada frame e tudo tremia.
                      if (columnSnapshot.current?.stageId !== stage.id) {
                        const snapshot: { id: string; mid: number }[] = [];
                        for (const c of cards) {
                          if (c.id === draggedId) continue;
                          const el = cardRefs.current.get(c.id);
                          if (!el) continue;
                          const rect = el.getBoundingClientRect();
                          snapshot.push({ id: c.id, mid: rect.top + rect.height / 2 });
                        }
                        columnSnapshot.current = { stageId: stage.id, cards: snapshot };
                      }
                      const snap = columnSnapshot.current.cards;
                      // Histerese: parte do índice JÁ conhecido e só troca se
                      // o mouse cruzar claramente além de uma margem de
                      // segurança (12px) da fronteira — sem isso, pequenas
                      // variações de sub-pixel bem em cima do ponto médio de
                      // dois cards vizinhos faziam o índice "piscar" entre
                      // os dois repetidamente, dando a sensação de disputa.
                      const margin = 12;
                      const knownIndex =
                        dropIndicator?.stageId === stage.id ? dropIndicator.index : snap.length;
                      let index = Math.min(knownIndex, snap.length);
                      while (index < snap.length && e.clientY > snap[index].mid + margin) index++;
                      while (index > 0 && e.clientY < snap[index - 1].mid - margin) index--;
                      setDropIndicatorStable({ stageId: stage.id, index });
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const draggedStage = draggedStageId.current;
                    draggedStageId.current = null;
                    if (draggedStage) {
                      const targetIndex = stageDropIndicator ?? stageIndex;
                      setStageDropIndicator(null);
                      void reorderStagesToIndex(draggedStage, targetIndex);
                      return;
                    }
                    const contact = draggedContact.current;
                    const card = dragged.current;
                    draggedContact.current = null;
                    dragged.current = null;
                    const idx =
                      dropIndicator?.stageId === stage.id ? dropIndicator.index : cards.length;
                    if (contact) {
                      // Se o contato já virou card neste funil, o drop move o
                      // card existente em vez de ser ignorado em silêncio.
                      const existing = active.cards.find((c) => c.wa_contact_id === contact.id);
                      if (existing) {
                        if (existing.stage_id !== stage.id)
                          void moveCardToPosition(existing, stage.id, idx);
                        setDropIndicator(null);
                        return;
                      }
                      void addCard(
                        stage.id,
                        {
                          title: contact.name || contact.phone || contact.wa_id,
                          phone: contact.phone ?? undefined,
                          wa_contact_id: contact.id,
                          wa_id: contact.wa_id,
                          label_ids: contact.label_ids,
                          unread_count: contact.unread_count,
                        },
                        idx,
                      );
                      setDropIndicator(null);
                      return;
                    }
                    if (card) {
                      void moveCardToPosition(card, stage.id, idx);
                    }
                    setDropIndicator(null);
                    // Limpeza defensiva: o moveCardToPosition reordena o
                    // estado de forma otimista IMEDIATAMENTE, o que pode
                    // desmontar/remontar o elemento original antes do evento
                    // nativo dragend conseguir disparar nele — sem isso, o
                    // destaque de "sendo arrastado" as vezes ficava preso.
                    setDraggingCardId(null);
                  }}
                  onDragLeave={(e) => {
                    // Só limpa se realmente saiu da coluna (não ao passar
                    // de um card filho pra outro dentro dela).
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setDropIndicator((prev) => (prev?.stageId === stage.id ? null : prev));
                      if (columnSnapshot.current?.stageId === stage.id)
                        columnSnapshot.current = null;
                    }
                  }}

                  className="flex max-h-[calc(100vh-108px)] w-72 shrink-0 flex-col rounded-xl border border-neutral-300 bg-[#eef0f1] py-2 pl-2 pr-1"
                  style={{
                    borderTop: `4px solid ${active.mode === "label" ? stage.color || "#3d5fa8" : "#3d5fa8"}`,
                    borderBottom: `4px solid ${active.mode === "label" ? stage.color || "#3d5fa8" : "#3d5fa8"}`,
                  }}
                >
                  <div
                    draggable
                    onDragStart={(e) => {
                      draggedStageId.current = stage.id;
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      draggedStageId.current = null;
                      setStageDropIndicator(null);
                    }}
                    title="Arrastar para reordenar"
                    className="flex select-none cursor-move items-center justify-between gap-2 active:cursor-move"
                  >
                    <div className="flex min-w-0 items-center gap-1">
                      <StageTitle
                        name={stage.name}
                        editing={renamingStage === stage.id}
                        onRename={(n: string) => {
                          setRenamingStage(null);
                          void renameStage(stage, n);
                        }}
                        onCancel={() => setRenamingStage(null)}
                      />
                    </div>
                    <div
                      className="flex shrink-0 items-center gap-1"
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <span className="shrink-0 rounded-full bg-neutral-200 px-2.5 py-1 text-xs font-bold text-neutral-700">
                        {allCards.length}
                      </span>
                      {stageTotalValue(stage.id) > 0 && (
                        <span
                          title="Soma do 'Valor do cliente' de todos os leads dessa etapa"
                          className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700"
                        >
                          {formatBRL(stageTotalValue(stage.id))}
                        </span>
                      )}
                      {active.mode !== "label" && (
                        <DotsMenu
                          items={[
                            { label: "Renomear", onClick: () => setRenamingStage(stage.id) },
                            {
                              label: "Mover leads para cá",
                              onClick: () =>
                                setBulkMoveTarget({ stageId: stage.id, stageName: stage.name }),
                            },
                            {
                              label: "Excluir",
                              danger: true,
                              onClick: () => void removeStage(stage.id),
                            },
                          ]}
                        />
                      )}
                    </div>
                  </div>

                  <div className="relative mt-2" onMouseDown={(e) => e.stopPropagation()}>
                    <svg
                      viewBox="0 0 24 24"
                      width="13"
                      height="13"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400"
                    >
                      <circle cx="11" cy="11" r="7" />
                      <path d="m20 20-3.5-3.5" />
                    </svg>
                    <input
                      value={stageSearch[stage.id] ?? ""}
                      onChange={(e) =>
                        setStageSearch((prev) => ({ ...prev, [stage.id]: e.target.value }))
                      }
                      placeholder="Buscar nesta aba..."
                      className="w-full rounded-lg border border-neutral-300 bg-white py-1.5 pl-7 pr-2 text-xs outline-none focus:border-brand"
                    />
                  </div>

                  <div className="thin-scrollbar mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
                    {cards.flatMap((card, cardIndex) => {
                      const showIndicatorBefore =
                        dropIndicator?.stageId === stage.id && dropIndicator.index === cardIndex;
                      const placeholder = showIndicatorBefore ? (
                        <div
                          key={`indicator-${card.id}`}
                          className="rounded-xl border-2 border-brand/50 bg-brand/5 transition-all duration-150"
                          style={{ height: draggedCardHeight.current }}
                        />
                      ) : null;

                      const cardEl = (
                        <div
                          key={card.id}
                          ref={(el) => {
                            if (el) cardRefs.current.set(card.id, el);
                            else cardRefs.current.delete(card.id);
                          }}
                          draggable
                          onDragStart={(e) => {
                            dragged.current = card;
                            draggedContact.current = null;
                            draggedCardHeight.current =
                              e.currentTarget.getBoundingClientRect().height;
                            setDraggingCardId(card.id);
                            e.dataTransfer.effectAllowed = "move";
                            try {
                              e.dataTransfer.setData("text/plain", card.id);
                            } catch {
                              /* noop */
                            }
                          }}
                          onDragEnd={() => {
                            dragged.current = null;
                            setDropIndicator(null);
                            setDraggingCardId(null);
                            columnSnapshot.current = null;
                          }}

                          className={
                            "select-none cursor-move outline-none rounded-xl border border-neutral-300 bg-white p-3 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-neutral-400 hover:shadow-md active:cursor-move " +
                            (draggingCardId === card.id ? "opacity-80 ring-2 ring-brand" : "")
                          }
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              {card?.profile_picture_url ? (
                                <Avatar className="h-7 w-7 shrink-0">
                                  <AvatarImage
                                    src={card.profile_picture_url}
                                    alt={card.title ?? ""}
                                  />
                                  <AvatarFallback className="text-[10px]">
                                    {(card.title ?? "").slice(0, 2).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                              ) : (
                                <div className="h-7 w-7 shrink-0 rounded-full bg-neutral-100 flex items-center justify-center text-[10px] text-neutral-400 font-bold">
                                  {(card?.title ?? "").slice(0, 2).toUpperCase()}
                                </div>
                              )}
                              <p className="min-w-0 truncate text-sm font-medium text-neutral-900">
                                {card.title}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              {card.followup && (
                                <FollowupBadge followup={card.followup} cardTitle={card.title} />
                              )}
                              {active.mode !== "label" && (
                                <button
                                  onClick={() => removeCard(card)}
                                  title="Remover lead"
                                  className="shrink-0 rounded-md p-1 text-neutral-400 transition hover:bg-red-50 hover:text-red-600"
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
                              )}
                            </div>
                          </div>
                          {card.notes && (
                            <span className="mt-1 inline-block rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-700">
                              anotação
                            </span>
                          )}

                          <div className="mt-2 flex items-center gap-1">
                            <div className="relative inline-block">
                              <CardAction
                                title="Abrir conversa no WhatsApp"
                                disabled={!canOpenWhatsapp(card.phone, card.wa_id)}
                                colorClass="text-emerald-600 hover:bg-emerald-50"
                                onClick={() =>
                                  void openWhatsappChat(card.phone || "", card.title, card.wa_id)
                                }
                              >
                                <IconWhatsapp />
                              </CardAction>
                              <UnreadBadge count={card.unread_count ?? 0} />
                            </div>
                            <div className="relative inline-block">
                              <CardAction
                                title="Anotações"
                                colorClass="text-sky-600 hover:bg-sky-50"
                                onClick={() => {
                                  setDetailTab("notes");
                                  setDetail(card);
                                }}
                              >
                                <IconNote />
                              </CardAction>
                              <NotesBadge count={card.notes_count ?? 0} />
                            </div>
                            <div className="relative inline-block">
                              <CardAction
                                title="Mensagem agendada / disparo"
                                colorClass="text-orange-600 hover:bg-orange-50"
                                onClick={() => {
                                  setDetailTab("schedule");
                                  setDetail(card);
                                }}
                              >
                                <IconClock />
                              </CardAction>
                              <UnreadBadge
                                count={card.schedule_count ?? 0}
                                colorClass="bg-blue-600"
                              />
                            </div>
                            <CardAction
                              title="Perfil e valor do cliente"
                              colorClass="text-violet-600 hover:bg-violet-50"
                              onClick={() => {
                                setDetailTab("profile");
                                setDetail(card);
                              }}
                            >
                              <IconProfile />
                            </CardAction>
                            <div className="relative inline-block">
                              <CardAction
                                title="Marcar atendimento (entra no Pós-venda)"
                                colorClass="text-amber-600 hover:bg-amber-50"
                                onClick={() => void handleMarkAttendance(card)}
                              >
                                <IconScissors />
                              </CardAction>
                              <UnreadBadge
                                count={card.attendance_count ?? 0}
                                colorClass="bg-amber-600"
                              />
                            </div>
                            {dealValueByKey.get(card.wa_contact_id || card.phone || "") ? (
                              <span className="ml-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                                {formatBRL(
                                  dealValueByKey.get(card.wa_contact_id || card.phone || "") || 0,
                                )}
                              </span>
                            ) : null}
                            {(card.label_ids ?? []).length > 0 ? (
                              (card.label_ids ?? []).map((labelId) => {
                                const lbl = labels.find((l) => l.wa_label_id === labelId);
                                if (!lbl) return null;
                                return <IconTag key={labelId} color={lbl.color} title={lbl.name} />;
                              })
                            ) : (
                              <IconTag color={null} title="Sem etiqueta" />
                            )}
                          </div>
                        </div>
                      );
                      return [placeholder, cardEl].filter(Boolean);
                    })}
                    {dropIndicator?.stageId === stage.id &&
                      dropIndicator.index === cards.length && (
                        <div
                          className="rounded-xl border-2 border-brand/50 bg-brand/5 transition-all duration-150"
                          style={{ height: draggedCardHeight.current }}
                        />
                      )}
                  </div>
                </div>
              );
              return [stagePlaceholder, columnEl].filter(Boolean);
            })}
            {stageDropIndicator === active.stages.length && (
              <div className="h-fit w-1 shrink-0 self-stretch rounded-full bg-brand/60 transition-all duration-150" />
            )}

            {active.mode !== "label" && <AddStageColumn onAdd={(name) => void addStage(name)} />}
          </div>
        </>
      )}

      {detail && (
        <CardDrawer
          key={detail.id}
          api={api}
          card={detail}
          initialTab={detailTab}
          onClose={() => {
            setDetail(null);
            void reload();
          }}
          onDealSaved={() => {
            api("/api/public/extension/customer-deal").then((r) => {
              if (r?.ok) setDealValues((r.deals as typeof dealValues) || []);
            });
          }}
        />
      )}

      {bulkMoveTarget && active && (
        <BulkMoveModal
          targetStageName={bulkMoveTarget.stageName}
          funnels={funnels}
          currentFunnelId={active.id}
          moving={bulkMoving}
          onClose={() => (bulkMoving ? null : setBulkMoveTarget(null))}
          onConfirm={(sourceFunnelId, sourceStageId) =>
            void bulkMoveLeads(sourceFunnelId, sourceStageId, bulkMoveTarget.stageId)
          }
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