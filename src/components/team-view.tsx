// Gamificação da equipe — 100% client-side (localStorage por barbearia).
// Cadastro de barbeiros, serviços, produtos e metas mora dentro de Configurações.

import { useEffect, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";

type Member = { id: string; name: string; photo?: string; emoji?: string };

function Avatar({ member, size = 40 }: { member: Member; size?: number }) {
  const initial = (member.name || "?").trim().charAt(0).toUpperCase();
  const cls =
    "grid shrink-0 place-items-center overflow-hidden rounded-full bg-neutral-200 font-semibold text-neutral-700 ring-1 ring-black/5";
  return (
    <div className={cls} style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>
      {member.photo ? <img src={member.photo} alt={member.name} className="h-full w-full object-cover" /> : initial}
    </div>
  );
}

async function fileToDataUrl(file: File, max = 320): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d")!.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

type CatalogItem = { id: string; name: string; priceCents: number };

type Entry = {
  id: string;
  memberId: string;
  kind: "service" | "product" | "extra";
  label: string;
  amountCents: number;
  points: number;
  createdAt: string;
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
  services: CatalogItem[];
  products: CatalogItem[];
};

const DEFAULT_STATE: TeamState = {
  members: [],
  entries: [],
  services: [],
  products: [],
  config: {
    monthGoalCents: 5000000,
    perMemberGoalCents: 1500000,
    pointsPerReal: 1,
    bonusExtra: 20,
  },
};

const EMOJIS = ["✂️", "💈", "🪒", "🔥", "⚡", "🥇", "🦁", "🐺", "👑", "🚀"];

function storageKey(shopId: string) { return `crm_team_v1_${shopId}`; }

function loadState(shopId: string): TeamState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const raw = localStorage.getItem(storageKey(shopId));
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_STATE,
      ...parsed,
      services: parsed.services ?? [],
      products: parsed.products ?? [],
      config: { ...DEFAULT_STATE.config, ...(parsed.config || {}) },
    };
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
          <button
            onClick={() => setShowConfig(true)}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
          >
            ⚙️ Configurações
          </button>
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
            <div className="h-full rounded-full bg-yellow-400 transition-all" style={{ width: `${shopPct}%` }} />
          </div>
        </div>
      </div>

      {/* Empty state */}
      {state.members.length === 0 && (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-10 text-center">
          <p className="text-4xl">💈</p>
          <h3 className="mt-3 text-base font-semibold text-neutral-900">Cadastre sua equipe</h3>
          <p className="mt-1 text-sm text-neutral-500">
            Abra Configurações para cadastrar barbeiros, serviços, produtos e definir as metas do mês.
          </p>
          <button
            onClick={() => setShowConfig(true)}
            className="mt-4 rounded-lg bg-neutral-900 px-5 py-2 text-sm font-semibold text-yellow-400 hover:bg-neutral-800"
          >
            Abrir configurações
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
                      <div className="h-full rounded-full bg-yellow-400" style={{ width: `${row.goalPct}%` }} />
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
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAddEntry && (
        <AddEntryModal
          member={state.members.find((m) => m.id === showAddEntry)!}
          config={state.config}
          services={state.services}
          products={state.products}
          onClose={() => setShowAddEntry(null)}
          onAdd={(entry) => setState((s) => ({ ...s, entries: [entry, ...s.entries] }))}
        />
      )}
      {showConfig && (
        <ConfigModal
          state={state}
          onClose={() => setShowConfig(false)}
          onChange={(next) => setState(next)}
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

function AddEntryModal({
  member,
  config,
  services,
  products,
  onClose,
  onAdd,
}: {
  member: Member;
  config: TeamConfig;
  services: CatalogItem[];
  products: CatalogItem[];
  onClose: () => void;
  onAdd: (e: Entry) => void;
}) {
  const [kind, setKind] = useState<"service" | "product" | "extra">("service");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const cents = Math.round(Number(amount.replace(",", ".")) * 100) || 0;
  const basePoints = Math.round((cents / 100) * config.pointsPerReal);
  const points = kind === "extra" ? basePoints + config.bonusExtra : basePoints;

  const catalog = kind === "service" ? services : kind === "product" ? products : [];

  function pickCatalog(id: string) {
    const item = catalog.find((c) => c.id === id);
    if (!item) return;
    setLabel(item.name);
    setAmount((item.priceCents / 100).toString().replace(".", ","));
  }

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
                onClick={() => { setKind(o.k); setLabel(""); setAmount(""); }}
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

        {catalog.length > 0 && (
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-neutral-700">
              {kind === "service" ? "Serviço do catálogo" : "Produto do catálogo"}
            </span>
            <select onChange={(e) => pickCatalog(e.target.value)} defaultValue="" className={inputCls}>
              <option value="">— escolher para preencher automaticamente —</option>
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>{c.name} · {fmtBRL(c.priceCents)}</option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-neutral-700">Descrição</span>
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

// --- Config modal com abas ---

type ConfigTab = "barbeiros" | "servicos" | "produtos" | "metas";

function ConfigModal({
  state,
  onClose,
  onChange,
  onResetMonth,
}: {
  state: TeamState;
  onClose: () => void;
  onChange: (s: TeamState) => void;
  onResetMonth: () => void;
}) {
  const [tab, setTab] = useState<ConfigTab>("barbeiros");

  const tabs: Array<{ k: ConfigTab; label: string }> = [
    { k: "barbeiros", label: "Barbeiros" },
    { k: "servicos", label: "Serviços" },
    { k: "produtos", label: "Produtos" },
    { k: "metas", label: "Metas & Pontos" },
  ];

  return (
    <ModalShell title="Configurações da equipe" onClose={onClose} wide>
      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-neutral-100 p-1">
        {tabs.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={
              "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition " +
              (tab === t.k ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-900")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "barbeiros" && (
        <MembersTab
          members={state.members}
          onAdd={(m) => onChange({ ...state, members: [...state.members, m] })}
          onRemove={(id) => onChange({ ...state, members: state.members.filter((m) => m.id !== id) })}
        />
      )}

      {tab === "servicos" && (
        <CatalogTab
          kind="service"
          items={state.services}
          onChange={(items) => onChange({ ...state, services: items })}
        />
      )}

      {tab === "produtos" && (
        <CatalogTab
          kind="product"
          items={state.products}
          onChange={(items) => onChange({ ...state, products: items })}
        />
      )}

      {tab === "metas" && (
        <MetasTab
          config={state.config}
          onSave={(cfg) => onChange({ ...state, config: cfg })}
          onResetMonth={onResetMonth}
        />
      )}
    </ModalShell>
  );
}

function MembersTab({
  members,
  onAdd,
  onRemove,
}: {
  members: Member[];
  onAdd: (m: Member) => void;
  onRemove: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(EMOJIS[0]);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Adicionar barbeiro</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome (ex: Bruno)"
          className={inputCls}
        />
        <div>
          <span className="mb-1 block text-xs font-medium text-neutral-600">Avatar</span>
          <div className="flex flex-wrap gap-2">
            {EMOJIS.map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => setEmoji(em)}
                className={
                  "h-10 w-10 rounded-lg border text-xl transition " +
                  (emoji === em ? "border-neutral-900 bg-white" : "border-neutral-200 bg-white hover:border-neutral-400")
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
            setName("");
          }}
          className="w-full rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-yellow-400 hover:bg-neutral-800 disabled:opacity-40"
        >
          Adicionar à equipe
        </button>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Equipe atual ({members.length})
        </p>
        {members.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
            Nenhum barbeiro cadastrado ainda.
          </p>
        ) : (
          <ul className="space-y-2">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3">
                <span className="text-2xl">{m.emoji}</span>
                <span className="flex-1 truncate text-sm font-medium text-neutral-900">{m.name}</span>
                <button
                  onClick={() => {
                    if (!confirm(`Remover ${m.name}? Os lançamentos ficam no histórico.`)) return;
                    onRemove(m.id);
                  }}
                  className="rounded-md border border-neutral-200 px-2.5 py-1 text-xs text-neutral-500 hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                >
                  remover
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CatalogTab({
  kind,
  items,
  onChange,
}: {
  kind: "service" | "product";
  items: CatalogItem[];
  onChange: (items: CatalogItem[]) => void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const label = kind === "service" ? "serviço" : "produto";

  function add() {
    if (!name.trim()) return;
    const cents = Math.round(Number(price.replace(",", ".")) * 100) || 0;
    onChange([...items, { id: crypto.randomUUID(), name: name.trim(), priceCents: cents }]);
    setName("");
    setPrice("");
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Adicionar {label}
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={kind === "service" ? "ex: Corte + Barba" : "ex: Pomada Modeladora"}
          className={inputCls}
        />
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="Preço (R$) — opcional"
          inputMode="decimal"
          className={inputCls}
        />
        <button
          disabled={!name.trim()}
          onClick={add}
          className="w-full rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-yellow-400 hover:bg-neutral-800 disabled:opacity-40"
        >
          Adicionar {label}
        </button>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Catálogo ({items.length})
        </p>
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
            Nenhum {label} cadastrado. Use o formulário acima.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((it) => (
              <li key={it.id} className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-900">{it.name}</p>
                  <p className="text-xs text-neutral-500">{fmtBRL(it.priceCents)}</p>
                </div>
                <button
                  onClick={() => onChange(items.filter((x) => x.id !== it.id))}
                  className="rounded-md border border-neutral-200 px-2.5 py-1 text-xs text-neutral-500 hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                >
                  remover
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MetasTab({
  config,
  onSave,
  onResetMonth,
}: {
  config: TeamConfig;
  onSave: (c: TeamConfig) => void;
  onResetMonth: () => void;
}) {
  const [monthGoal, setMonthGoal] = useState(String(config.monthGoalCents / 100));
  const [perMemberGoal, setPerMemberGoal] = useState(String(config.perMemberGoalCents / 100));
  const [ppr, setPpr] = useState(String(config.pointsPerReal));
  const [bonus, setBonus] = useState(String(config.bonusExtra));

  return (
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
        }}
        className="w-full rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-yellow-400 hover:bg-neutral-800"
      >
        Salvar metas
      </button>
      <button
        onClick={onResetMonth}
        className="w-full rounded-lg border border-red-300 bg-white px-4 py-2 text-sm text-red-600 hover:bg-red-50"
      >
        Zerar lançamentos do mês
      </button>
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/50 backdrop-blur-sm p-4">
      <div className={"w-full rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto " + (wide ? "max-w-2xl" : "max-w-md")}>
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
