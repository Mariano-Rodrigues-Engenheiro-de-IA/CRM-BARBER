// Funis de vendas — kanbans customizáveis criados de três formas:
//   • Aba        → também aparece como aba no topo do WhatsApp Web
//   • Listas     → alimentado por uma lista (etiqueta) nativa do WhatsApp
//   • Novo funil → colunas e leads montados manualmente
//
// Os cards seguem o mesmo padrão dos kanbans de assinaturas:
// anotações, mensagem agendada e disparo/abrir conversa no WhatsApp.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  formatBRL,
  type Funnel,
  type FunnelCard,
  type FunnelMode,
  type WaContact,
  type WaLabel,
} from "@/lib/funnels";
import {
  applyFunnelActions,
  canOpenWhatsapp,
  isRealPhone,
  openWhatsappChat,
} from "@/lib/wa-actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { sendableActions, type QuickReply } from "@/lib/quick-replies";

type ApiFn = (path: string, opts?: RequestInit) => Promise<Record<string, unknown>>;

const inputCls =
  "w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-brand";

/** Cache entre navegações: voltar pra aba Funis não deve piscar esqueleto. */
let funnelsCache: { funnels: Funnel[]; labels: WaLabel[]; contacts: WaContact[] } | null = null;
/** Trava global para evitar que múltiplos componentes (ou remounts) criem funis padrão ao mesmo tempo. */
let isEnsuringDefaults = false;

export function FunnelsView({ api, headerHost }: { api: ApiFn; headerHost?: HTMLElement | null }) {
  const [funnels, setFunnels] = useState<Funnel[]>(() => funnelsCache?.funnels ?? []);
  const [labels, setLabels] = useState<WaLabel[]>(() => funnelsCache?.labels ?? []);
  const [contacts, setContacts] = useState<WaContact[]>(() => funnelsCache?.contacts ?? []);
  const [activeId, setActiveId] = useState<string | null>(
    () => funnelsCache?.funnels[0]?.id ?? null,
  );
  const [loading, setLoading] = useState(!funnelsCache);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<FunnelCard | null>(null);
  const [detailTab, setDetailTab] = useState<"notes" | "schedule" | "profile" | "deal">("notes");
  const [inboxQuery, setInboxQuery] = useState("");
  const [renamingStage, setRenamingStage] = useState<string | null>(null);
  const [stageSearch, setStageSearch] = useState<Record<string, string>>({});
  const [dropIndicator, setDropIndicator] = useState<{ stageId: string; index: number } | null>(null);
  const draggedCardHeight = useRef<number>(72);
  const [stageDropIndicator, setStageDropIndicator] = useState<number | null>(null);
  // Valor do cliente somado — carregado uma vez, em lote, pra mostrar tanto
  // o valor individual em cada card quanto o total parado em cada etapa.
  const [dealValues, setDealValues] = useState<Array<{ wa_contact_id: string | null; phone: string | null; value_cents: number | null }>>([]);
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  // Snapshot ESTÁTICO das posições dos cards de uma coluna, capturado uma
  // única vez ao entrar nela durante o arraste — evita o loop de
  // realimentação onde re-medir o DOM a cada movimento (que a própria
  // inserção do placeholder já alterou) causava o card "trocar de alvo"
  // continuamente e tremer.
  const columnSnapshot = useRef<{ stageId: string; cards: { id: string; mid: number }[] } | null>(null);
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
      api("/api/public/extension/funnels"),
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

  /**
   * "Funil principal" e "Listas" são fixos: nascem sozinhos e
   * não podem ser excluídos. O botão do cabeçalho só cria funis personalizados.
   */
  async function ensureDefaults(list: Funnel[]) {
    if (isEnsuringDefaults) return false;
    isEnsuringDefaults = true;
    try {
      let created = false;

      // 1) Garantir apenas UM funil principal (mode: tab)
      // Buscamos qualquer funil que seja "tab" ou que tenha o nome "Funil principal"
      const tabFunnels = list.filter((f) => f.mode === "tab" || f.name === "Funil principal");
      if (tabFunnels.length === 0) {
        const r = await api("/api/public/extension/funnels", {
          method: "POST",
          body: JSON.stringify({
            name: "Funil principal",
            mode: "tab",
            stages: ["Novo lead", "Em conversa", "Negociando", "Fechado"],
          }),
        });
        created = created || Boolean(r?.ok);
      } else if (tabFunnels.length > 1) {
        // Limpa duplicados: mantém o primeiro que for realmente "tab", ou o primeiro da lista
        const keep = tabFunnels.find(f => f.mode === "tab") || tabFunnels[0];
        for (const dup of tabFunnels) {
          if (dup.id === keep.id) continue;
          await api(`/api/public/extension/funnels/${dup.id}`, { method: "DELETE" });
          created = true;
        }
      }

      // 2) Garantir apenas UM funil de listas (mode: label)
      const labelFunnels = list.filter((f) => f.mode === "label");
      if (labelFunnels.length === 0) {
        const r = await api("/api/public/extension/funnels", {
          method: "POST",
          body: JSON.stringify({ name: "Listas", mode: "label", stages: [] }),
        });
        created = created || Boolean(r?.ok);
      } else if (labelFunnels.length > 1) {
        const keep = labelFunnels.find((f) => f.name === "Listas") || labelFunnels[0];
        for (const dup of labelFunnels) {
          if (dup.id === keep.id) continue;
          await api(`/api/public/extension/funnels/${dup.id}`, { method: "DELETE" });
          created = true;
        }
      }

      // 3) Renomear legado se necessário
      const legacy = list.find((f) => f.mode === "label" && f.name !== "Listas");
      if (legacy && labelFunnels.length === 1) {
        await api(`/api/public/extension/funnels/${legacy.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: "Listas" }),
        });
        created = true;
      }

      return created;
    } finally {
      isEnsuringDefaults = false;
    }
  }

  /** Mantém somente as colunas. Os contatos são renderizados diretamente do
   * snapshot do WhatsApp, sem criar/deletar centenas de cards em sequência. */
  async function syncLabelFunnel(list: Funnel[], ls: WaLabel[], cs: WaContact[]) {
    const funnel = list.find((f) => f.mode === "label");
    if (!funnel) return false;

    // Detecta stages duplicados por nome (pode ter acontecido antes desta
    // lógica de dedup existir). Mantém só um por nome — o de menor
    // sort_order — e manda o resto pra remoção junto com os "stale".
    const seenNames = new Set<string>();
    const duplicateIds: string[] = [];
    for (const s of [...funnel.stages].sort((a, b) => a.sort_order - b.sort_order)) {
      if (seenNames.has(s.name)) {
        duplicateIds.push(s.id);
      } else {
        seenNames.add(s.name);
      }
    }
    const uniqueStages = funnel.stages.filter((s) => !duplicateIds.includes(s.id));

    // 1) Colunas = listas do WhatsApp (na mesma ordem).
    const byName = new Map(uniqueStages.map((s) => [s.name, s]));
    const stale = uniqueStages.filter((s) => !ls.some((l) => l.name === s.name));
    const missing = ls.filter((l) => !byName.has(l.name));
    // Verifica se houve mudança nas colunas ou nas cores das etiquetas
    const hasColorChange = ls.some(l => {
      const stage = byName.get(l.name);
      return stage && stage.color !== l.color;
    });

    if (stale.length || missing.length || duplicateIds.length || hasColorChange) {
      await api(`/api/public/extension/funnels/${funnel.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          stages: ls.map((l, i) => {
            const found = byName.get(l.name);
            return found
              ? { id: found.id, name: l.name, color: l.color, sort_order: i }
              : { name: l.name, color: l.color, sort_order: i };
          }),
          removed_stage_ids: [...stale.map((s) => s.id), ...duplicateIds],
        }),
      });
      return true;
    }

    return false;
  }

  useEffect(() => {
    void (async () => {
      const r = await reload();
      if (!r) return;
      const created = await ensureDefaults(r.list);
      const base = created ? await reload() : r;
      if (await syncLabelFunnel(base.list, base.labels, base.contacts)) await reload();
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
    return cards.reduce((sum, c) => sum + (dealValueByKey.get(c.wa_contact_id || c.phone || "") || 0), 0);
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
          body: JSON.stringify({ id: c.id, stage_id: c.stage_id, sort_order: c.sort_order }),
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

    setFunnels((list) =>
      list.map((f) => (f.id !== funnelId ? f : { ...f, stages: withNewOrder })),
    );
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
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400">
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

                      className="select-none cursor-grab outline-none rounded-xl border border-neutral-300 bg-white p-3 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-neutral-400 hover:shadow-md active:cursor-grabbing"
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
                    (c) => (c.title ?? "").toLowerCase().includes(search) || (c.phone ?? "").includes(search),
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
                      const knownIndex = dropIndicator?.stageId === stage.id ? dropIndicator.index : snap.length;
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
                    const idx = dropIndicator?.stageId === stage.id ? dropIndicator.index : cards.length;
                    if (contact) {
                      // Se o contato já virou card neste funil, o drop move o
                      // card existente em vez de ser ignorado em silêncio.
                      const existing = active.cards.find((c) => c.wa_contact_id === contact.id);
                      if (existing) {
                        if (existing.stage_id !== stage.id) void moveCardToPosition(existing, stage.id, idx);
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
                      if (columnSnapshot.current?.stageId === stage.id) columnSnapshot.current = null;
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
                    onDragEnd={() => { draggedStageId.current = null; setStageDropIndicator(null); }}
                    title="Arrastar para reordenar"
                    className="flex select-none cursor-grab items-center justify-between gap-2 active:cursor-grabbing"
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
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400">
                      <circle cx="11" cy="11" r="7" />
                      <path d="m20 20-3.5-3.5" />
                    </svg>
                    <input
                      value={stageSearch[stage.id] ?? ""}
                      onChange={(e) => setStageSearch((prev) => ({ ...prev, [stage.id]: e.target.value }))}
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
                            draggedCardHeight.current = e.currentTarget.getBoundingClientRect().height;
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
                            "select-none cursor-grab outline-none rounded-xl border border-neutral-300 bg-white p-3 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-neutral-400 hover:shadow-md active:cursor-grabbing " +
                            (draggingCardId === card.id ? "opacity-80 ring-2 ring-brand" : "")
                          }
                        >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {card?.profile_picture_url ? (
                              <Avatar className="h-7 w-7 shrink-0">
                                <AvatarImage src={card.profile_picture_url} alt={card.title ?? ""} />
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
                          {active.mode !== "label" && (
                            <button
                              onClick={() => removeCard(card)}
                              title="Remover lead"
                              className="shrink-0 rounded-md p-1 text-neutral-400 transition hover:bg-red-50 hover:text-red-600"
                            >
                              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M4 7h16" />
                                <path d="M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7" />
                                <path d="M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7" />
                                <path d="M10 11v6M14 11v6" />
                              </svg>
                            </button>
                          )}
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
                          <CardAction
                            title="Perfil do cliente"
                            colorClass="text-violet-600 hover:bg-violet-50"
                            onClick={() => {
                              setDetailTab("profile");
                              setDetail(card);
                            }}
                          >
                            <IconProfile />
                          </CardAction>
                          <CardAction
                            title="Valor do cliente"
                            colorClass="text-emerald-700 hover:bg-emerald-50"
                            onClick={() => {
                              setDetailTab("deal");
                              setDetail(card);
                            }}
                          >
                            <IconDeal />
                          </CardAction>
                          {dealValueByKey.get(card.wa_contact_id || card.phone || "") ? (
                            <span className="ml-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                              {formatBRL(dealValueByKey.get(card.wa_contact_id || card.phone || "") || 0)}
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
                    {dropIndicator?.stageId === stage.id && dropIndicator.index === cards.length && (
                      <div className="rounded-xl border-2 border-brand/50 bg-brand/5 transition-all duration-150" style={{ height: draggedCardHeight.current }} />
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
      <h3 className="truncate text-sm font-semibold uppercase tracking-wide text-neutral-900">
        {name}
      </h3>
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
      className="w-full min-w-0 rounded-md border border-neutral-300 px-2 py-1 text-sm font-semibold uppercase tracking-wide text-neutral-900 outline-none focus:border-brand"
    />
  );
}

/** Menu de três pontos reutilizável (colunas e funis). */
function DotsMenu({
  items,
}: {
  items: { label: string; onClick: () => void; danger?: boolean }[];
}) {
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
        <div className="absolute right-0 top-6 z-20 w-36 overflow-hidden rounded-xl border border-neutral-300 bg-white py-1 shadow-lg">
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
        className="min-w-0 rounded-md border border-neutral-300 px-2 py-1 text-[13px] font-semibold uppercase tracking-widest text-neutral-900 outline-none focus:border-brand"
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
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden
        >
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
        <div className="absolute left-0 top-7 z-30 w-56 overflow-hidden rounded-xl border border-neutral-300 bg-white py-1 shadow-lg">
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
                (f.id === activeId ? "font-semibold text-brand" : "text-neutral-600")
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

/** Selo de mensagens não lidas, sobreposto no canto do botão de WhatsApp. */
function UnreadBadge({ count }: { count: number }) {
  if (!count || count <= 0) return null;
  return (
    <span className="absolute -bottom-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

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
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={
        "rounded-md p-1 transition disabled:opacity-40 " +
        (colorClass ?? "text-neutral-500 hover:text-brand")
      }
    >
      {children}
    </button>
  );
}

const IconWhatsapp = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 2C6.5 2 2 6.4 2 11.8c0 1.9.5 3.7 1.5 5.3L2 22l5.1-1.4c1.5.8 3.2 1.3 4.9 1.3 5.5 0 10-4.4 10-9.9C22 6.4 17.5 2 12 2Zm5.6 14c-.2.7-1.4 1.3-2 1.4-.5.1-1.2.1-1.9-.1-.4-.1-1-.3-1.7-.6-3-1.3-4.9-4.3-5.1-4.5-.1-.2-1.2-1.6-1.2-3.1s.8-2.2 1.1-2.5c.3-.3.6-.4.8-.4h.6c.2 0 .5 0 .7.6l1 2.3c.1.2.1.4 0 .6l-.5.6-.4.5c-.1.2-.3.4-.1.7.2.3.9 1.4 1.9 2.3 1.3 1.2 2.4 1.5 2.7 1.7.3.2.5.1.7-.1l.9-1c.2-.3.4-.2.7-.1l2.1 1c.3.1.6.2.6.4.1.2.1.9-.1 1.6Z" />
  </svg>
);
const IconNote = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 3.5h9.5L19 7v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z" />
    <path d="M15.2 3.5V7h3.6" />
    <path d="M8.3 12h7M8.3 15.3h7M8.3 18.5h4.3" />
  </svg>
);
const IconClock = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="11" cy="13" r="8" />
    <path d="M11 9.2V13l2.6 1.6" />
    <path d="M8.2 2.6h5.6M18.5 5l1.6-1.6" />
  </svg>
);
const IconProfile = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" />
  </svg>
);
const IconDeal = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v10" />
    <path d="M9 9.5c0-1.4 1.3-2.5 3-2.5s3 .9 3 2.1c0 1.7-1.6 2.2-3.2 2.7-1.6.5-2.8 1.1-2.8 2.6 0 1.2 1.3 2.1 3 2.1s3-1 3-2.3" />
  </svg>
);

/** Ícone de etiqueta (formato de bandeirinha inclinada), colorido com a cor
 * real da etiqueta do WhatsApp. Mostra o nome só no hover (title), sem
 * poluir o card com texto fixo. */
function IconTag({ color, title }: { color: string | null; title: string }) {
  return (
    <span
      title={title}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-xl border border-neutral-300 bg-white"
    >
      {color ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill={color} aria-hidden>
          <path d="M20.59 13.41 12 22l-9-9V4a1 1 0 0 1 1-1h9l9 9a2 2 0 0 1 0 2.82Z" />
          <circle cx="6.5" cy="6.5" r="1.5" fill="white" />
        </svg>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#d4d4d4"
          strokeWidth="1.5"
          aria-hidden
        >
          <path d="M20.59 13.41 12 22l-9-9V4a1 1 0 0 1 1-1h9l9 9a2 2 0 0 1 0 2.82Z" />
          <circle cx="6.5" cy="6.5" r="1.5" />
        </svg>
      )}
    </span>
  );
}

function Overlay({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="mt-16 w-full max-w-lg rounded-xl border border-neutral-300 bg-white p-6 shadow-xl">
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

/** Rótulo + campo — usado nas abas de Perfil e Valor do cliente. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-600">{label}</span>
      {children}
    </label>
  );
}

/** Pipeline do lead do funil: anotações + mensagem agendada/disparo. */
function CardDrawer({
  api,
  card,
  initialTab,
  onClose,
  onDealSaved,
}: {
  api: ApiFn;
  card: FunnelCard;
  initialTab: "notes" | "schedule" | "profile" | "deal";
  onClose: () => void;
  onDealSaved?: () => void;
}) {
  // Cada ícone do card abre um painel dedicado, sem sub-abas pra trocar —
  // por isso não precisa de estado próprio, só usa o que veio de fora.
  const tab = initialTab;
  const [notes, setNotes] = useState(card.notes ?? "");
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  // Resumo gerado pela IA (projeto IA-BARBER-AGENDA) — busca separada,
  // pra não pesar a lista geral de clientes com esse campo toda vez.
  const [aiSummary, setAiSummary] = useState<{ text: string; updatedAt: string | null } | null>(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);

  useEffect(() => {
    if (!isRealPhone(card.phone)) return;
    setAiSummaryLoading(true);
    api(`/api/public/extension/customers?phone=${encodeURIComponent(card.phone || "")}`)
      .then((r) => {
        const customers = (r as Record<string, unknown>).customers;
        if (!Array.isArray(customers) || customers.length === 0) return;
        const c = customers[0] as Record<string, unknown>;
        if (c?.ai_summary) setAiSummary({ text: c.ai_summary as string, updatedAt: (c.ai_summary_updated_at ?? null) as string | null });
      })
      .finally(() => setAiSummaryLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.phone]);

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

  // Perfil do cliente / Valor do cliente — mesmos dados acessíveis pela
  // extensão do WhatsApp (ícones na conversa), aqui dentro do card do funil.
  const contactQuery = card.wa_contact_id
    ? `wa_contact_id=${encodeURIComponent(card.wa_contact_id)}`
    : card.phone
      ? `phone=${encodeURIComponent(card.phone)}`
      : null;
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [deal, setDeal] = useState<Record<string, unknown> | null>(null);
  const [dealLoaded, setDealLoaded] = useState(false);
  // Campo de texto solto do valor — não deriva de deal.value_cents a cada
  // tecla (isso reformatava o campo no meio da digitação e travava em 1
  // dígito). Só vira number de verdade na hora de salvar.
  const [dealValueText, setDealValueText] = useState("");
  const [cpBusy, setCpBusy] = useState(false);
  const [cpSaved, setCpSaved] = useState(false);

  useEffect(() => {
    if (tab === "profile" && !profileLoaded && contactQuery) {
      api(`/api/public/extension/customer-profile?${contactQuery}`).then((r) => {
        const p = ((r?.ok ? r.profile : null) as Record<string, unknown> | null) || {};
        // Se ainda não tem nome salvo no perfil, usa o nome que o card já
        // tem (o mesmo resolvido lá na conversa do WhatsApp).
        if (!p.name && card.title) p.name = card.title;
        setProfile(p);
        setProfileLoaded(true);
      });
    }
    if (tab === "deal" && !dealLoaded && contactQuery) {
      api(`/api/public/extension/customer-deal?${contactQuery}`).then((r) => {
        const d = ((r?.ok ? r.deal : null) as Record<string, unknown> | null) || {};
        setDeal(d);
        setDealValueText(d.value_cents != null ? ((d.value_cents as number) / 100).toFixed(2).replace(".", ",") : "");
        setDealLoaded(true);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function saveProfile() {
    if (!profile) return;
    setCpBusy(true);
    await api("/api/public/extension/customer-profile", {
      method: "PATCH",
      body: JSON.stringify({ wa_contact_id: card.wa_contact_id || null, phone: card.phone || null, ...profile }),
    });
    setCpBusy(false);
    setCpSaved(true);
    setTimeout(() => setCpSaved(false), 1800);
  }

  async function saveDeal() {
    if (!deal) return;
    setCpBusy(true);
    const num = parseFloat(dealValueText.replace(/\./g, "").replace(",", "."));
    const value_cents = dealValueText.trim() === "" ? null : Number.isFinite(num) ? Math.round(num * 100) : null;
    // Espelha na anotação do card do funil também — é a mesma "Anotações"
    // que já existe no CRM, só editável agora pelo WhatsApp também.
    if (card.id && typeof deal.notes === "string" && deal.notes !== (card.notes ?? "")) {
      await api("/api/public/extension/funnel-cards", {
        method: "PATCH",
        body: JSON.stringify({ id: card.id, notes: deal.notes || null }),
      });
      setNotes(deal.notes as string);
    }
    await api("/api/public/extension/customer-deal", {
      method: "PATCH",
      body: JSON.stringify({ wa_contact_id: card.wa_contact_id || null, phone: card.phone || null, ...deal, value_cents }),
    });
    setDeal({ ...deal, value_cents });
    setCpBusy(false);
    setCpSaved(true);
    onDealSaved?.();
    setTimeout(() => setCpSaved(false), 1800);
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

        {aiSummaryLoading && (
          <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3 text-xs text-neutral-400">
            Carregando resumo da IA...
          </div>
        )}
        {aiSummary && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-blue-700">
              <span>✨</span> Resumo da IA
            </div>
            <p className="whitespace-pre-wrap text-xs text-neutral-700">{aiSummary.text}</p>
            {aiSummary.updatedAt && (
              <p className="mt-1.5 text-[10px] text-neutral-400">
                Atualizado {new Date(aiSummary.updatedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {tab === "notes" ? "Anotações" : tab === "schedule" ? "Mensagens agendadas" : tab === "profile" ? "Perfil do cliente" : "Valor do cliente"}
          </h4>
          {canOpenWhatsapp(card.phone, card.wa_id) && (
            <button
              onClick={() => void openWhatsappChat(card.phone || "", card.title, card.wa_id)}
              className="flex items-center gap-1.5 rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
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
                className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
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
              className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
            >
              {busy ? "Enviando..." : when ? "Agendar mensagem" : "Enviar mensagem"}
            </button>
          </>
        )}

        {tab === "profile" && (
          <div className="space-y-3">
            {!contactQuery && <p className="text-sm text-neutral-500">Sem telefone/contato vinculado a esse lead.</p>}
            {contactQuery && !profileLoaded && <p className="text-sm text-neutral-400">Carregando...</p>}
            {contactQuery && profileLoaded && profile && (
              <>
                <Field label="Nome">
                  <input className={inputCls} value={(profile.name as string) ?? ""} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
                </Field>
                <Field label="Email">
                  <input className={inputCls} value={(profile.email as string) ?? ""} onChange={(e) => setProfile({ ...profile, email: e.target.value })} placeholder="email@exemplo.com" />
                </Field>
                <Field label="Sexo">
                  <select className={inputCls} value={(profile.gender as string) ?? ""} onChange={(e) => setProfile({ ...profile, gender: e.target.value })}>
                    <option value="">Selecione um sexo</option>
                    <option value="feminino">Feminino</option>
                    <option value="masculino">Masculino</option>
                    <option value="outro">Outro</option>
                    <option value="prefiro_nao_dizer">Prefiro não dizer</option>
                  </select>
                </Field>
                <Field label="Data de nascimento">
                  <input type="date" className={inputCls} value={(profile.birth_date as string) ?? ""} onChange={(e) => setProfile({ ...profile, birth_date: e.target.value })} />
                </Field>
                <Field label="Idioma">
                  <input className={inputCls} value={(profile.language as string) ?? ""} onChange={(e) => setProfile({ ...profile, language: e.target.value })} placeholder="Português" />
                </Field>
                <Field label="País">
                  <input className={inputCls} value={(profile.country as string) ?? ""} onChange={(e) => setProfile({ ...profile, country: e.target.value })} placeholder="Brasil" />
                </Field>
                <Field label="Cidade">
                  <input className={inputCls} value={(profile.city as string) ?? ""} onChange={(e) => setProfile({ ...profile, city: e.target.value })} />
                </Field>
                <div className="flex items-center gap-3">
                  <button onClick={saveProfile} disabled={cpBusy} className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50">
                    Salvar perfil
                  </button>
                  {cpSaved && <span className="text-xs font-medium text-emerald-600">Salvo ✔</span>}
                </div>
              </>
            )}
          </div>
        )}

        {tab === "deal" && (
          <div className="space-y-3">
            {!contactQuery && <p className="text-sm text-neutral-500">Sem telefone/contato vinculado a esse lead.</p>}
            {contactQuery && !dealLoaded && <p className="text-sm text-neutral-400">Carregando...</p>}
            {contactQuery && dealLoaded && deal && (
              <>
                <Field label="Estágio do contato">
                  <input className={inputCls} value={(deal.stage_label as string) ?? ""} onChange={(e) => setDeal({ ...deal, stage_label: e.target.value })} placeholder="Ex: Qualificando" />
                </Field>
                <Field label="Estado">
                  <input className={inputCls} value={(deal.state as string) ?? ""} onChange={(e) => setDeal({ ...deal, state: e.target.value })} placeholder="Ex: SP" />
                </Field>
                <Field label="Origem do lead">
                  <input className={inputCls} value={(deal.lead_source as string) ?? ""} onChange={(e) => setDeal({ ...deal, lead_source: e.target.value })} placeholder="Ex: Instagram, indicação..." />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Data de entrada">
                    <input type="date" className={inputCls} value={(deal.entry_date as string) ?? ""} onChange={(e) => setDeal({ ...deal, entry_date: e.target.value })} />
                  </Field>
                  <Field label="Data de saída">
                    <input type="date" className={inputCls} value={(deal.exit_date as string) ?? ""} onChange={(e) => setDeal({ ...deal, exit_date: e.target.value })} />
                  </Field>
                </div>
                <Field label="Valor do negócio (R$)">
                  <input
                    className={inputCls}
                    value={dealValueText}
                    onChange={(e) => setDealValueText(e.target.value)}
                    placeholder="0,00"
                    inputMode="decimal"
                  />
                </Field>
                <Field label="Empresa">
                  <input className={inputCls} value={(deal.company as string) ?? ""} onChange={(e) => setDeal({ ...deal, company: e.target.value })} placeholder="Nome da empresa" />
                </Field>
                <Field label="Cargo">
                  <input className={inputCls} value={(deal.role as string) ?? ""} onChange={(e) => setDeal({ ...deal, role: e.target.value })} placeholder="Cargo do contato" />
                </Field>
                <Field label="Produtos de interesse">
                  <input className={inputCls} value={(deal.products_of_interest as string) ?? ""} onChange={(e) => setDeal({ ...deal, products_of_interest: e.target.value })} />
                </Field>
                <Field label="Observações">
                  <textarea rows={3} className={inputCls} value={(deal.notes as string) ?? ""} onChange={(e) => setDeal({ ...deal, notes: e.target.value })} placeholder="Adicione uma observação" />
                </Field>
                <div className="flex items-center gap-3">
                  <button onClick={saveDeal} disabled={cpBusy} className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50">
                    Salvar
                  </button>
                  {cpSaved && <span className="text-xs font-medium text-emerald-600">Salvo ✔</span>}
                </div>
              </>
            )}
          </div>
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
  onCreate: (body: {
    name: string;
    mode: FunnelMode;
    source_label_id?: string | null;
    stages?: string[];
  }) => void;
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
          <button
            onClick={onClose}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
          >
            Criar
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/** Coluna especial no final da fileira — clicar abre um campo simples
 * pra digitar o nome da nova aba/estágio do funil. */
function AddStageColumn({ onAdd }: { onAdd: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  function confirm() {
    if (name.trim()) onAdd(name.trim());
    setName("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex h-full w-56 shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-neutral-300 text-sm font-medium text-neutral-400 transition hover:border-brand hover:text-brand"
      >
        + Nova aba
      </button>
    );
  }

  return (
    <div className="flex h-fit w-56 shrink-0 flex-col gap-2 rounded-xl border border-neutral-300 bg-[#eef0f1] p-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") confirm();
          if (e.key === "Escape") { setOpen(false); setName(""); }
        }}
        placeholder="Nome da aba"
        className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-brand"
      />
      <div className="flex gap-1">
        <button
          onClick={confirm}
          disabled={!name.trim()}
          className="flex-1 rounded-lg bg-brand px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          Adicionar
        </button>
        <button
          onClick={() => { setOpen(false); setName(""); }}
          className="rounded-lg border border-neutral-300 px-2 py-1.5 text-xs text-neutral-600"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
