// Componentes auxiliares do Kanban de funis: título editável da coluna,
// menu de três pontinhos, seletor de funil, badges (follow-up, não lidas,
// notas), botão de ação do card, e os modais (mover em massa, novo funil,
// coluna nova). Extraído de funnels-view.tsx pra reduzir o tamanho desse
// arquivo (era um dos 3 arquivos gigantes apontados na varredura de
// código morto/arquitetura).

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clock } from "lucide-react";
import { type Funnel, type FunnelCard, type FunnelMode } from "@/lib/funnels";
import { type ApiFn, inputCls } from "@/components/funnels-view";

export function StageTitle({
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
export function DotsMenu({
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
export function FunnelPicker({
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
/** Countdown curto e legível pro badge de follow-up — "em 2h", "em 5min",
 * "agora" (já passou da hora, esperando a próxima rodada do avaliador). */
function humanizeDue(dueAtIso: string | null): string {
  if (!dueAtIso) return "";
  const diffMs = new Date(dueAtIso).getTime() - Date.now();
  if (diffMs <= 0) return "agora";
  const min = Math.round(diffMs / 60_000);
  if (min < 60) return `em ${min}min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `em ${hours}h`;
  const days = Math.round(hours / 24);
  return `em ${days}d`;
}

/** Reloginho de follow-up no card — mostra de cara se esse lead ainda vai
 * receber alguma mensagem da sequência (e quando) ou se já recebeu tudo.
 * Clicar abre um relatório rápido com os detalhes. */
export function FollowupBadge({
  followup,
  cardTitle,
}: {
  followup: NonNullable<FunnelCard["followup"]>;
  cardTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const isOverdue =
    !followup.all_sent &&
    followup.next_due_at &&
    new Date(followup.next_due_at).getTime() <= Date.now();
  const colorClass = followup.all_sent
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : isOverdue
      ? "bg-amber-50 text-amber-700 border-amber-300 animate-pulse"
      : "bg-neutral-100 text-neutral-600 border-neutral-200";

  function toggleOpen(e: React.MouseEvent) {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const popWidth = 224; // w-56
      setPos({
        top: rect.bottom + 6,
        left: Math.min(Math.max(8, rect.left), window.innerWidth - popWidth - 8),
      });
    }
    setOpen((v) => !v);
  }

  return (
    <div className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        draggable={false}
        onMouseDown={(e) => e.stopPropagation()}
        onDragStart={(e) => e.preventDefault()}
        onClick={toggleOpen}
        title="Status do follow-up"
        className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium transition hover:brightness-95 ${colorClass}`}
      >
        <Clock className="h-2.5 w-2.5" />
        {followup.sent_count}/{followup.total_steps}
      </button>
      {open &&
        pos &&
        createPortal(
          // Portal pro <body> de propósito, não só position: fixed — o
          // card inteiro é draggable, e um popup vivendo dentro dele (mesmo
          // com fixed) ainda faz parte da mesma árvore de drag do
          // navegador, causando aquele tremor ao clicar (o navegador tenta
          // iniciar um arraste do card ao mesmo tempo que abre o popup).
          // Um portal de verdade tira o popup dessa árvore.
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
            />
            <div
              className="fixed z-50 w-56 rounded-xl border border-neutral-200 bg-white p-3 text-left shadow-lg"
              style={{ top: pos.top, left: pos.left }}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="mb-1 truncate text-xs font-semibold text-neutral-900">{cardTitle}</p>
              <p className="text-xs text-neutral-600">
                {followup.sent_count} de {followup.total_steps} mensagem
                {followup.total_steps === 1 ? "" : "s"} da sequência enviada
                {followup.sent_count === 1 ? "" : "s"}.
              </p>
              {followup.all_sent ? (
                <p className="mt-1.5 text-xs font-medium text-emerald-700">Sequência concluída.</p>
              ) : (
                <p className="mt-1.5 text-xs font-medium text-neutral-700">
                  Próxima mensagem:{" "}
                  {isOverdue ? "processando agora" : humanizeDue(followup.next_due_at)}
                </p>
              )}
              {followup.last_sent_at && (
                <p className="mt-1 text-[11px] text-neutral-400">
                  Última enviada{" "}
                  {new Date(followup.last_sent_at).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              )}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

export function UnreadBadge({
  count,
  colorClass = "bg-emerald-600",
}: {
  count: number;
  colorClass?: string;
}) {
  if (!count || count <= 0) return null;
  return (
    <span
      className={`absolute -bottom-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white ${colorClass}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** Selinho de "tem anotação" — um lápis pequeno, sem número (não importa
 * quantas, só se tem alguma). Formato e proporção calcados no
 * UnreadBadge (mesmo tamanho de círculo, mesmo anel branco), pra ficar
 * visualmente da mesma família, só trocando o conteúdo. */
export function NotesBadge({ count }: { count: number }) {
  if (!count || count <= 0) return null;
  return (
    <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-sky-600 text-white ring-2 ring-white">
      <svg
        viewBox="0 0 24 24"
        width="9"
        height="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </span>
  );
}

export function CardAction({
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

export function Overlay({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Mesmo padrão visual do diálogo nativo usado na extensão do WhatsApp
  // (fundo claro, sem escurecer feito modal pesado; cantos arredondados;
  // entrada suave) — antes era um modal escuro e quadrado, bem diferente
  // do resto do sistema.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-5 transition-opacity duration-150"
      style={{ background: "rgba(11,20,26,0.18)", opacity: shown ? 1 : 0 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-md max-h-[calc(100vh-64px)] overflow-y-auto rounded-2xl bg-white shadow-2xl transition-all duration-150"
        style={{ transform: shown ? "translateY(0) scale(1)" : "translateY(6px) scale(0.98)" }}
      >
        <div className="flex items-center gap-2.5 px-5 pb-1 pt-5">
          <h3 className="flex-1 text-[19px] font-extrabold text-neutral-900">{title}</h3>
          <button
            onClick={onClose}
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100"
          >
            ✕
          </button>
        </div>
        <div className="px-5 pb-5 pt-3">{children}</div>
      </div>
    </div>
  );
}

/** Mover em massa: escolhe funil + etapa de ORIGEM (todo funil que não
 * seja o atual, exceto os de modo "label" — auto-gerados do WhatsApp,
 * sem mover manual) — confirma e TODOS os leads daquela etapa vêm pra
 * cá de uma vez, um por um (delete lá, create aqui). */
export function BulkMoveModal({
  targetStageName,
  funnels,
  currentFunnelId,
  moving,
  onClose,
  onConfirm,
}: {
  targetStageName: string;
  funnels: Funnel[];
  currentFunnelId: string;
  moving: boolean;
  onClose: () => void;
  onConfirm: (sourceFunnelId: string, sourceStageId: string) => void;
}) {
  const otherFunnels = funnels.filter((f) => f.id !== currentFunnelId && f.mode !== "label");
  const [sourceFunnelId, setSourceFunnelId] = useState(otherFunnels[0]?.id ?? "");
  const sourceFunnel = funnels.find((f) => f.id === sourceFunnelId);
  const [sourceStageId, setSourceStageId] = useState(sourceFunnel?.stages[0]?.id ?? "");

  // Trocou de funil de origem — a etapa selecionada é de outro funil e
  // não faz mais sentido, volta pra primeira etapa do novo escolhido.
  useEffect(() => {
    setSourceStageId(sourceFunnel?.stages[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFunnelId]);

  const count = (sourceFunnel?.cards ?? []).filter((c) => c.stage_id === sourceStageId).length;

  if (!otherFunnels.length) {
    return (
      <Overlay title={`Mover leads para "${targetStageName}"`} onClose={onClose}>
        <p className="text-sm text-neutral-500">
          Mover em massa precisa de outro funil pra puxar os leads. Crie um funil novo primeiro.
        </p>
      </Overlay>
    );
  }

  return (
    <Overlay title={`Mover leads para "${targetStageName}"`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-neutral-500">
          Escolha de qual funil e etapa você quer puxar TODOS os leads. Eles saem de lá e entram
          aqui.
        </p>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-neutral-600">Funil de origem</label>
          <select
            value={sourceFunnelId}
            onChange={(e) => setSourceFunnelId(e.target.value)}
            disabled={moving}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand disabled:opacity-50"
          >
            {otherFunnels.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-neutral-600">Etapa de origem</label>
          <select
            value={sourceStageId}
            onChange={(e) => setSourceStageId(e.target.value)}
            disabled={moving}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand disabled:opacity-50"
          >
            {(sourceFunnel?.stages ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <p className="text-sm text-neutral-600">
          {count === 0
            ? "Essa etapa não tem nenhum lead no momento."
            : `${count} lead${count === 1 ? "" : "s"} ${count === 1 ? "vai" : "vão"} ser movido${count === 1 ? "" : "s"} pra cá.`}
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            disabled={moving}
            className="rounded-md px-4 py-2 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => sourceStageId && onConfirm(sourceFunnelId, sourceStageId)}
            disabled={moving || !sourceStageId || count === 0}
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {moving ? "Movendo..." : `Mover ${count || ""} lead${count === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/** Rótulo + campo — usado nas abas de Perfil e Valor do cliente. */

/** Só cria funis personalizados: os fixos nascem automaticamente. */
export function NewFunnelModal({
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
export function AddStageColumn({ onAdd }: { onAdd: (name: string) => void }) {
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
          if (e.key === "Escape") {
            setOpen(false);
            setName("");
          }
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
          onClick={() => {
            setOpen(false);
            setName("");
          }}
          className="rounded-lg border border-neutral-300 px-2 py-1.5 text-xs text-neutral-600"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

