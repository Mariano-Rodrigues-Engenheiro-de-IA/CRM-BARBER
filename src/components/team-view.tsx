// Gamificação da equipe — 100% client-side (localStorage por barbearia).
// Tema claro para combinar com o resto do painel.

import { useEffect, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";

type Member = {
  id: string;
  name: string;
  emoji: string;
};

type Entry = {
  id: string;
  memberId: string;
  kind: "service" | "product" | "extra";
  label: string;
  amountCents: number;
  points: number;
  createdAt: string; // ISO
};

type TeamConfig = {
  monthGoalCents: number;
  perMemberGoalCents: number;
  pointsPerReal: number;
  bonusExtra: number;
};

type TeamState = {
  members: Member[];
  entries: Entry[];
  config: TeamConfig;
};

const DEFAULT_STATE: TeamState = {
  members: [],
  entries: [],
  config: {
    monthGoalCents: 5000000,
    perMemberGoalCents: 1500000,
    pointsPerReal: 1,
    bonusExtra: 20,
  },
};

const EMOJIS = ["✂️", "💈", "🪒", "🔥", "⚡", "🥇", "🦁", "🐺", "👑", "🚀"];

function storageKey(shopId: string) {
  return `crm_team_v1_${shopId}`;
}

function loadState(shopId: string): TeamState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const raw = localStorage.getItem(storageKey(shopId));
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_STATE, ...parsed, config: { ...DEFAULT_STATE.config, ...(parsed.config || {}) } };
  } catch {
    return DEFAULT_STATE;
  }
}

function saveState(shopId: string, state: TeamState) {
  localStorage.setItem(storageKey(shopId), JSON.stringify(state));
}

function fmtBRL(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function isCurrentMonth(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function fireConfetti() {
  const duration = 2500;
  const end = Date.now() + duration;
  const colors = ["#facc15", "#fbbf24", "#f59e0b", "#171717", "#404040"];
  (function frame() {
    confetti({ particleCount: 6, angle: 60, spread: 70, origin: { x: 0 }, colors });
    confetti({ particleCount: 6, angle: 120, spread: 70, origin: { x: 1 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

export function TeamView({ shopId }: { shopId: string }) {
  const [state, setState] = useState<TeamState>(DEFAULT_STATE);
  const [ready, setReady] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showAddEntry, setShowAddEntry] = useState<null | string>(null);
  const celebratedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setState(loadState(shopId));
    setReady(true);
  }, [shopId]);

  useEffect(() => {
    if (ready) saveState(shopId, state);
  }, [state, shopId, ready]);

  const stats = useMemo(() => {
    const monthly = state.entries.filter((e) => isCurrentMonth(e.createdAt));
    const totalCents = monthly.reduce((s, e) => s + e.amountCents, 0);
    const totalPoints = monthly.reduce((s, e) => s + e.points, 0);
    const perMember = state.members.map((m) => {
      const es = monthly.filter((e) => e.memberId === m.id);
      const cents = es.reduce((s, e) => s + e.amountCents, 0);
      const points = es.reduce((s, e) => s + e.points, 0);
      const extras = es.filter((e) => e.kind === "extra").length;
      const products = es.filter((e) => e.kind === "product").length;
      const services = es.filter((e) => e.kind === "service").length;
      const goalPct = state.config.perMemberGoalCents
        ? Math.min(100, Math.round((cents / state.config.perMemberGoalCents) * 100))
        : 0;
      return { member: m, cents, points, extras, products, services, goalPct, count: es.length };
    });
    perMember.sort((a, b) => b.points - a.points);
    return { totalCents, totalPoints, perMember };
  }, [state]);

  useEffect(() => {
    if (!ready) return;
    for (const row of stats.perMember) {
      if (row.cents >= state.config.perMemberGoalCents && state.config.perMemberGoalCents > 0) {
        const key = `${row.member.id}-${new Date().getMonth()}-${new Date().getFullYear()}`;
        if (!celebratedRef.current.has(key)) {
          celebratedRef.current.add(key);
          fireConfetti();
        }
      }
    }
  }, [stats, state.config.perMemberGoalCents, ready]);

  const shopPct = state.config.monthGoalCents
    ? Math.min(100, Math.round((stats.totalCents / state.config.monthGoalCents) * 100))
    : 0;

  if (!ready) return null;

  return (
    <div className="space-y-6">
      {/* Header + KPIs */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-neutral-900">Ranking da equipe</h2>
            <p className="text-sm text-neutral-500">Competição do mês · pontos, faturamento e metas</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowAddMember(true)}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-yellow-400 hover:bg-neutral-800"
            >
              + Barbeiro
            </button>
            <button
              onClick={() => setShowConfig(true)}
              className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
            >
              Configurar
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <Kpi label="Faturamento do mês" value={fmtBRL(stats.totalCents)} sub={`Meta: ${fmtBRL(state.config.monthGoalCents)}`} />
          <Kpi label="Pontos totais" value={String(stats.totalPoints)} sub={`${state.entries.filter((e) => isCurrentMonth(e.createdAt)).length} lançamentos`} />
          <Kpi
            label="Progresso geral"
            value={`${shopPct}%`}
            sub={shopPct >= 100 ? "🏆 meta batida!" : `faltam ${fmtBRL(Math.max(0, state.config.monthGoalCents - stats.totalCents))}`}
          />
        </div>

        <div className="mt-5">
          <div className="h-2.5 overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-yellow-400 transition-all"
              style={{ width: `${shopPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Empty state */}
      {state.members.length === 0 && (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-10 text-center">
          <p className="text-4xl">💈</p>
          <h3 className="mt-3 text-base font-semibold text-neutral-900">Cadastre sua equipe</h3>
          <p className="mt-1 text-sm text-neutral-500">
            Adicione os barbeiros para começar o placar do mês.
          </p>
          <button
            onClick={() => setShowAddMember(true)}
            className="mt-4 rounded-lg bg-neutral-900 px-5 py-2 text-sm font-semibold text-yellow-400 hover:bg-neutral-800"
          >
            + Adicionar primeiro barbeiro
          </button>
        </div>
      )}

      {/* Ranking */}
      {state.members.length > 0 && (
        <div className="space-y-3">
          {stats.perMember.map((row, idx) => {
            const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx + 1}`;
            const isLeader = idx === 0 && row.points > 0;
            return (
              <div
                key={row.member.id}
                className={
                  "rounded-2xl border p-5 shadow-sm transition " +
                  (isLeader
                    ? "border-yellow-400 bg-white ring-2 ring-yellow-400/30"
                    : "border-neutral-200 bg-white hover:border-neutral-300")
                }
              >
                <div className="flex flex-wrap items-center gap-4">
                  <div className="text-2xl font-semibold tabular-nums text-neutral-700 min-w-12">{medal}</div>
                  <div className="text-4xl">{row.member.emoji}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-neutral-900">{row.member.name}</h3>
                      {row.goalPct >= 100 && (
                        <span className="rounded-full bg-yellow-400 px-2 py-0.5 text-[10px] font-bold uppercase text-neutral-900">
                          Meta batida
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3 text-xs text-neutral-600">
                      <span>💰 {fmtBRL(row.cents)}</span>
                      <span>⭐ {row.points} pts</span>
                      <span>✂️ {row.services} serv.</span>
                      <span>🛒 {row.products} prod.</span>
                      <span>🎯 {row.extras} extras</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-100">
                      <div
                        className="h-full rounded-full bg-yellow-400"
                        style={{ width: `${row.goalPct}%` }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between text-[11px] text-neutral-500">
                      <span>Meta individual: {fmtBRL(state.config.perMemberGoalCents)}</span>
                      <span>{row.goalPct}%</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => setShowAddEntry(row.member.id)}
                      className="rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-yellow-400 hover:bg-neutral-800"
                    >
                      + Lançar venda
                    </button>
                    <button
                      onClick={() => {
                        if (!confirm(`Remover ${row.member.name} da equipe? Os lançamentos ficam no histórico.`)) return;
                        setState((s) => ({ ...s, members: s.members.filter((m) => m.id !== row.member.id) }));
                      }}
                      className="rounded-lg border border-neutral-200 px-3 py-1 text-[11px] text-neutral-500 hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                    >
                      remover
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAddMember && (
        <AddMemberModal
          onClose={() => setShowAddMember(false)}
          onAdd={(m) => setState((s) => ({ ...s, members: [...s.members, m] }))}
        />
      )}
      {showAddEntry && (
        <AddEntryModal
          member={state.members.find((m) => m.id === showAddEntry)!}
          config={state.config}
          onClose={() => setShowAddEntry(null)}
          onAdd={(entry) => setState((s) => ({ ...s, entries: [entry, ...s.entries] }))}
        />
      )}
      {showConfig && (
        <ConfigModal
          config={state.config}
          onClose={() => setShowConfig(false)}
          onSave={(cfg) => setState((s) => ({ ...s, config: cfg }))}
          onResetMonth={() => {
            if (!confirm("Zerar todos os lançamentos deste mês? Não dá pra desfazer.")) return;
            setState((s) => ({ ...s, entries: s.entries.filter((e) => !isCurrentMonth(e.createdAt)) }));
            celebratedRef.current.clear();
          }}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-neutral-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-neutral-500">{sub}</p>}
    </div>
  );
}

// --- Modals ---

function AddMemberModal({ onClose, onAdd }: { onClose: () => void; onAdd: (m: Member) => void }) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  return (
    <ModalShell title="Novo barbeiro" onClose={onClose}>
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-neutral-700">Nome</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ex: Bruno"
            className={inputCls}
          />
        </label>
        <div>
          <span className="mb-2 block text-sm font-medium text-neutral-700">Avatar</span>
          <div className="flex flex-wrap gap-2">
            {EMOJIS.map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => setEmoji(em)}
                className={
                  "h-11 w-11 rounded-lg border text-2xl transition " +
                  (emoji === em
                    ? "border-neutral-900 bg-neutral-100"
                    : "border-neutral-200 bg-white hover:border-neutral-400")
                }
              >
                {em}
              </button>
            ))}
          </div>
        </div>
        <button
          disabled={!name.trim()}
          onClick={() => {
            onAdd({ id: crypto.randomUUID(), name: name.trim(), emoji });
            onClose();
          }}
          className="w-full rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-yellow-400 hover:bg-neutral-800 disabled:opacity-40"
        >
          Adicionar à equipe
        </button>
      </div>
    </ModalShell>
  );
}

function AddEntryModal({
  member,
  config,
  onClose,
  onAdd,
}: {
  member: Member;
  config: TeamConfig;
  onClose: () => void;
  onAdd: (e: Entry) => void;
}) {
  const [kind, setKind] = useState<"service" | "product" | "extra">("service");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const cents = Math.round(Number(amount.replace(",", ".")) * 100) || 0;
  const basePoints = Math.round((cents / 100) * config.pointsPerReal);
  const points = kind === "extra" ? basePoints + config.bonusExtra : basePoints;
  return (
    <ModalShell title={`Lançar venda · ${member.emoji} ${member.name}`} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <span className="mb-2 block text-sm font-medium text-neutral-700">Tipo</span>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { k: "service", label: "✂️ Serviço" },
                { k: "product", label: "🛒 Produto" },
                { k: "extra", label: "🎯 Extra" },
              ] as const
            ).map((o) => (
              <button
                key={o.k}
                type="button"
                onClick={() => setKind(o.k)}
                className={
                  "rounded-lg border px-3 py-2 text-sm font-medium " +
                  (kind === o.k
                    ? "border-neutral-900 bg-neutral-900 text-yellow-400"
                    : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400")
                }
              >
                {o.label}
              </button>
            ))}
          </div>
          {kind === "extra" && (
            <p className="mt-1 text-[11px] text-neutral-600">
              +{config.bonusExtra} pontos bônus por venda extra/upsell
            </p>
          )}
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-neutral-700">Descrição (opcional)</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex: Corte + Barba" className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-neutral-700">Valor (R$)</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="60,00"
            className={inputCls}
          />
        </label>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
          Vai valer <strong className="text-neutral-900">{points} pontos</strong> · {fmtBRL(cents)}
        </div>
        <button
          disabled={cents <= 0}
          onClick={() => {
            onAdd({
              id: crypto.randomUUID(),
              memberId: member.id,
              kind,
              label: label.trim() || (kind === "service" ? "Serviço" : kind === "product" ? "Produto" : "Extra"),
              amountCents: cents,
              points,
              createdAt: new Date().toISOString(),
            });
            onClose();
          }}
          className="w-full rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-yellow-400 hover:bg-neutral-800 disabled:opacity-40"
        >
          Registrar
        </button>
      </div>
    </ModalShell>
  );
}

function ConfigModal({
  config,
  onClose,
  onSave,
  onResetMonth,
}: {
  config: TeamConfig;
  onClose: () => void;
  onSave: (c: TeamConfig) => void;
  onResetMonth: () => void;
}) {
  const [monthGoal, setMonthGoal] = useState(String(config.monthGoalCents / 100));
  const [perMemberGoal, setPerMemberGoal] = useState(String(config.perMemberGoalCents / 100));
  const [ppr, setPpr] = useState(String(config.pointsPerReal));
  const [bonus, setBonus] = useState(String(config.bonusExtra));
  return (
    <ModalShell title="Configurar gamificação" onClose={onClose}>
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-neutral-700">Meta de faturamento do mês (R$)</span>
          <input value={monthGoal} onChange={(e) => setMonthGoal(e.target.value)} className={inputCls} inputMode="decimal" />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-neutral-700">Meta individual por barbeiro (R$)</span>
          <input value={perMemberGoal} onChange={(e) => setPerMemberGoal(e.target.value)} className={inputCls} inputMode="decimal" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-neutral-700">Pontos por R$1</span>
            <input value={ppr} onChange={(e) => setPpr(e.target.value)} className={inputCls} inputMode="decimal" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-neutral-700">Bônus por venda extra</span>
            <input value={bonus} onChange={(e) => setBonus(e.target.value)} className={inputCls} inputMode="decimal" />
          </label>
        </div>
        <button
          onClick={() => {
            onSave({
              monthGoalCents: Math.round(Number(monthGoal.replace(",", ".")) * 100) || 0,
              perMemberGoalCents: Math.round(Number(perMemberGoal.replace(",", ".")) * 100) || 0,
              pointsPerReal: Number(ppr.replace(",", ".")) || 1,
              bonusExtra: Number(bonus.replace(",", ".")) || 0,
            });
            onClose();
          }}
          className="w-full rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-yellow-400 hover:bg-neutral-800"
        >
          Salvar
        </button>
        <button
          onClick={onResetMonth}
          className="w-full rounded-lg border border-red-300 bg-white px-4 py-2 text-sm text-red-600 hover:bg-red-50"
        >
          Zerar lançamentos do mês
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/10";
