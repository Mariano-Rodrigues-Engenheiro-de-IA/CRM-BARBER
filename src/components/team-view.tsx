// Gamificação da equipe — 100% client-side (localStorage por barbearia).
// Cadastro de barbeiros, serviços, produtos e metas mora dentro de Configurações.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import confetti from "canvas-confetti";
import { useConfirm } from "@/components/confirm-dialog";

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

/** Cliente da barbearia — usado para jornada de compra e ranking de clientes. */
type Client = { id: string; name: string; phone?: string; createdAt: string };

type Entry = {
  id: string;
  memberId: string;
  kind: "service" | "product" | "extra";
  label: string;
  amountCents: number;
  points: number;
  createdAt: string;
  clientId?: string;
  clientName?: string;
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
  clients: Client[];
};

const DEFAULT_STATE: TeamState = {
  members: [],
  entries: [],
  services: [],
  products: [],
  clients: [],
  config: {
    monthGoalCents: 5000000,
    perMemberGoalCents: 1500000,
    pointsPerReal: 1,
    bonusExtra: 20,
  },
};



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
      clients: parsed.clients ?? [],
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

type Period = "day" | "week" | "month" | "year" | "custom";

function startOfPeriod(period: Period, custom?: { from: string; to: string }): { from: Date; to: Date; label: string } {
  const now = new Date();
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  if (period === "day") return { from, to, label: "Hoje" };
  if (period === "week") {
    const day = from.getDay();
    const diff = day === 0 ? 6 : day - 1;
    from.setDate(from.getDate() - diff);
    return { from, to, label: "Esta semana" };
  }
  if (period === "month") {
    from.setDate(1);
    return { from, to, label: "Este mês" };
  }
  if (period === "year") {
    from.setMonth(0, 1);
    return { from, to, label: "Este ano" };
  }
  const cf = custom?.from ? new Date(custom.from + "T00:00:00") : from;
  const ct = custom?.to ? new Date(custom.to + "T23:59:59") : to;
  return { from: cf, to: ct, label: "Personalizado" };
}

function inRange(iso: string, from: Date, to: Date) {
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t <= to.getTime();
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

export function TeamView({ shopId, headerHost }: { shopId: string; headerHost?: HTMLDivElement | null }) {
  const { confirm, dialog } = useConfirm();
  const [state, setState] = useState<TeamState>(DEFAULT_STATE);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<"ranking" | "clientes">("ranking");
  const [showConfig, setShowConfig] = useState(false);
  const [showAddEntry, setShowAddEntry] = useState<null | string>(null);
  const [showPerf, setShowPerf] = useState<null | string>(null);
  const monthStart = (() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); })();
  const todayIso = new Date().toISOString().slice(0, 10);
  const [customFrom, setCustomFrom] = useState(monthStart);
  const [customTo, setCustomTo] = useState(todayIso);
  const celebratedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setState(loadState(shopId));
    setReady(true);
  }, [shopId]);

  useEffect(() => {
    if (ready) saveState(shopId, state);
  }, [state, shopId, ready]);

  const range = useMemo(
    () => startOfPeriod("custom", { from: customFrom, to: customTo }),
    [customFrom, customTo],
  );

  const stats = useMemo(() => {
    const filtered = state.entries.filter((e) => inRange(e.createdAt, range.from, range.to));
    const totalCents = filtered.reduce((s, e) => s + e.amountCents, 0);
    const totalPoints = filtered.reduce((s, e) => s + e.points, 0);
    const perMember = state.members.map((m) => {
      const es = filtered.filter((e) => e.memberId === m.id);
      const cents = es.reduce((s, e) => s + e.amountCents, 0);
      const points = es.reduce((s, e) => s + e.points, 0);
      const extras = es.filter((e) => e.kind === "extra").length;
      const products = es.filter((e) => e.kind === "product").length;
      const services = es.filter((e) => e.kind === "service").length;
      const goalPct = state.config.perMemberGoalCents
        ? Math.min(100, Math.round((cents / state.config.perMemberGoalCents) * 100))
        : 0;
      return { member: m, cents, points, extras, products, services, goalPct, count: es.length, entries: es };
    });
    perMember.sort((a, b) => b.points - a.points);
    return { totalCents, totalPoints, perMember, count: filtered.length };
  }, [state, range]);

  useEffect(() => {
    if (!ready) return;
    for (const row of stats.perMember) {
      if (row.cents >= state.config.perMemberGoalCents && state.config.perMemberGoalCents > 0) {
        const key = `${row.member.id}-${customFrom}-${customTo}`;
        if (!celebratedRef.current.has(key)) {
          celebratedRef.current.add(key);
          fireConfetti();
        }
      }
    }
  }, [stats, state.config.perMemberGoalCents, ready, customFrom, customTo]);

  const shopPct = state.config.monthGoalCents
    ? Math.min(100, Math.round((stats.totalCents / state.config.monthGoalCents) * 100))
    : 0;

  if (!ready) return null;

  async function deleteEntry(id: string) {
    const ok = await confirm({
      title: "Excluir esse lançamento?",
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    setState((s) => ({ ...s, entries: s.entries.filter((e) => e.id !== id) }));
  }

  const medalFor = (idx: number, points: number) => {
    if (points <= 0) return null;
    if (idx === 0) return { emoji: "🥇", ring: "ring-yellow-400", bg: "bg-yellow-100", label: "1º lugar" };
    if (idx === 1) return { emoji: "🥈", ring: "ring-neutral-400", bg: "bg-neutral-100", label: "2º lugar" };
    if (idx === 2) return { emoji: "🥉", ring: "ring-amber-600/50", bg: "bg-amber-50", label: "3º lugar" };
    return null;
  };

  const nav = (
    <nav className="flex shrink-0 gap-1 rounded-lg bg-neutral-100 p-1">
      {(["ranking", "clientes"] as const).map((t) => (
        <button
          key={t}
          onClick={() => setTab(t)}
          className={
            "rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition " +
            (tab === t ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-900")
          }
        >
          {t === "ranking" ? "Equipe" : "Clientes"}
        </button>
      ))}
    </nav>
  );

  return (
    <div className="space-y-6">
      {dialog}
      {/* As abas moram no cabeçalho fixo do topo (mesmo padrão das outras seções). */}
      {headerHost
        ? createPortal(nav, headerHost)
        : nav}

      {tab === "clientes" && (
        <ClientsPanel
          clients={state.clients}
          entries={state.entries}
          onAddClient={(c) => setState((s) => ({ ...s, clients: [c, ...s.clients] }))}
          onRemoveClient={async (id) => {
            const ok = await confirm({ title: "Remover esse cliente?", confirmLabel: "Remover", destructive: true });
            if (!ok) return;
            setState((s) => ({ ...s, clients: s.clients.filter((c) => c.id !== id) }));
          }}
        />
      )}

      {tab === "ranking" && (
      <>
      {/* Header + KPIs */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-neutral-900">Ranking da equipe</h2>
          </div>
          <button
            onClick={() => setShowConfig(true)}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong"
          >
            Acessar
          </button>
        </div>

        {/* Custom date range */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="text-xs text-neutral-500">período</span>
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-800"
          />
          <span className="text-xs text-neutral-500">até</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-800"
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
          <Kpi label="Faturamento" value={fmtBRL(stats.totalCents)} sub={`Meta mês: ${fmtBRL(state.config.monthGoalCents)}`} />
          <Kpi label="Pontos totais" value={String(stats.totalPoints)} sub={`${stats.count} lançamentos`} />
          <Kpi
            label="Progresso vs meta mês"
            value={`${shopPct}%`}
            sub={shopPct >= 100 ? "meta batida" : `faltam ${fmtBRL(Math.max(0, state.config.monthGoalCents - stats.totalCents))}`}
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
          <h3 className="text-base font-semibold text-neutral-900">Cadastre sua equipe</h3>
          <p className="mt-1 text-sm text-neutral-500">
            Abra Acessar para cadastrar barbeiros, serviços, produtos e definir as metas do mês.
          </p>
          <button
            onClick={() => setShowConfig(true)}
            className="mt-4 rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-strong"
          >
            Acessar
          </button>
        </div>
      )}

      {/* Ranking */}
      {state.members.length > 0 && (
        <div className="space-y-3">
          {stats.perMember.map((row, idx) => {
            const medal = medalFor(idx, row.points);
            return (
              <div
                key={row.member.id}
                className={
                  "rounded-2xl border p-5 shadow-sm transition " +
                  (medal
                    ? `border-transparent bg-white ring-2 ${medal.ring}`
                    : "border-neutral-200 bg-white hover:border-neutral-300")
                }
              >
                <div className="flex flex-wrap items-center gap-4">
                  <div
                    className={
                      "grid h-12 w-12 shrink-0 place-items-center rounded-full text-2xl " +
                      (medal ? medal.bg : "bg-neutral-100")
                    }
                    title={medal?.label ?? `${idx + 1}º lugar`}
                  >
                    {medal ? medal.emoji : (
                      <span className="text-sm font-semibold text-neutral-600">{idx + 1}º</span>
                    )}
                  </div>
                  <Avatar member={row.member} size={56} />
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
                      <span>{fmtBRL(row.cents)}</span>
                      <span>{row.points} pts</span>
                      <span>{row.services} serv.</span>
                      <span>{row.products} prod.</span>
                      <span>{row.extras} extras</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-100">
                      <div className="h-full rounded-full bg-yellow-400" style={{ width: `${row.goalPct}%` }} />
                    </div>
                    <div className="mt-1 flex justify-between text-[11px] text-neutral-500">
                      <span>Meta individual: {fmtBRL(state.config.perMemberGoalCents)}</span>
                      <span>{row.goalPct}%</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => setShowAddEntry(row.member.id)}
                      className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-brand-strong"
                    >
                      + Lançar venda
                    </button>
                    <button
                      onClick={() => setShowPerf(row.member.id)}
                      className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
                    >
                      Ver desempenho
                    </button>
                  </div>
                </div>

                {row.entries.length > 0 && (
                  <details className="mt-4 rounded-lg bg-neutral-50 p-3">
                    <summary className="cursor-pointer text-xs font-medium text-neutral-600">
                      Lançamentos no período ({row.entries.length})
                    </summary>
                    <ul className="mt-2 divide-y divide-neutral-200">
                      {[...row.entries]
                        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
                        .map((e) => (
                          <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-neutral-900">{e.label}</p>
                              <p className="text-[10px] uppercase tracking-wide text-neutral-500">
                                {e.kind === "service" ? "Serviço" : e.kind === "product" ? "Produto" : "Extra"} ·{" "}
                                {new Date(e.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} ·{" "}
                                {fmtBRL(e.amountCents)} · {e.points} pts
                              </p>
                            </div>
                            <button
                              onClick={() => deleteEntry(e.id)}
                              className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-[11px] text-red-600 hover:bg-red-50 hover:border-red-300"
                              title="Excluir lançamento"
                            >
                              Excluir
                            </button>
                          </li>
                        ))}
                    </ul>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
      </>
      )}

      {showAddEntry && (
        <AddEntryModal
          member={state.members.find((m) => m.id === showAddEntry)!}
          config={state.config}
          services={state.services}
          products={state.products}
          clients={state.clients}
          onAddClient={(c) => setState((s) => ({ ...s, clients: [c, ...s.clients] }))}
          onClose={() => setShowAddEntry(null)}
          onAdd={(entry) => setState((s) => ({ ...s, entries: [entry, ...s.entries] }))}
        />
      )}
      {showPerf && (() => {
        const m = state.members.find((mm) => mm.id === showPerf)!;
        const row = stats.perMember.find((r) => r.member.id === showPerf);
        return (
          <PerformanceModal
            member={m}
            entries={row?.entries ?? []}
            periodLabel={range.label}
            onClose={() => setShowPerf(null)}
            onDelete={deleteEntry}
          />
        );
      })()}
      {showConfig && (
        <ConfigModal
          state={state}
          onClose={() => setShowConfig(false)}
          onChange={(next) => setState(next)}
          onResetMonth={async () => {
            const ok = await confirm({
              title: "Zerar todos os lançamentos deste mês?",
              description: "Não dá pra desfazer.",
              confirmLabel: "Zerar",
              destructive: true,
            });
            if (!ok) return;
            const r = startOfPeriod("month");
            setState((s) => ({ ...s, entries: s.entries.filter((e) => !inRange(e.createdAt, r.from, r.to)) }));
            celebratedRef.current.clear();
          }}
        />
      )}
    </div>
  );
}


function PerformanceModal({
  member,
  entries,
  periodLabel,
  onClose,
  onDelete,
}: {
  member: Member;
  entries: Entry[];
  periodLabel: string;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {

  const totalCents = entries.reduce((s, e) => s + e.amountCents, 0);
  const totalPoints = entries.reduce((s, e) => s + e.points, 0);
  const byKind = {
    service: entries.filter((e) => e.kind === "service"),
    product: entries.filter((e) => e.kind === "product"),
    extra: entries.filter((e) => e.kind === "extra"),
  };
  const sorted = [...entries].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return (
    <ModalShell title={`Desempenho · ${member.name}`} onClose={onClose} wide>
      <p className="mb-4 text-xs uppercase tracking-wider text-neutral-500">{periodLabel}</p>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Faturamento" value={fmtBRL(totalCents)} />
        <Kpi label="Pontos" value={String(totalPoints)} />
        <Kpi label="Serviços" value={String(byKind.service.length)} sub={fmtBRL(byKind.service.reduce((s, e) => s + e.amountCents, 0))} />
        <Kpi label="Produtos + extras" value={String(byKind.product.length + byKind.extra.length)} sub={fmtBRL(byKind.product.concat(byKind.extra).reduce((s, e) => s + e.amountCents, 0))} />
      </div>
      {sorted.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
          Nenhum lançamento nesse período.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
          {sorted.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-neutral-900">{e.label}</p>
                <p className="text-[11px] uppercase tracking-wide text-neutral-500">
                  {e.kind === "service" ? "Serviço" : e.kind === "product" ? "Produto" : "Extra"} ·{" "}
                  {new Date(e.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-neutral-900">{fmtBRL(e.amountCents)}</p>
                <p className="text-[11px] text-neutral-500">{e.points} pts</p>
              </div>
              <button
                onClick={() => onDelete(e.id)}
                className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-[11px] text-red-600 hover:bg-red-50 hover:border-red-300"
              >
                Excluir
              </button>
            </li>
          ))}
        </ul>
      )}
    </ModalShell>
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
  clients,
  onAddClient,
  onClose,
  onAdd,
}: {
  member: Member;
  config: TeamConfig;
  services: CatalogItem[];
  products: CatalogItem[];
  clients: Client[];
  onAddClient: (c: Client) => void;
  onClose: () => void;
  onAdd: (e: Entry) => void;
}) {
  const [kind, setKind] = useState<"service" | "product" | "extra">("service");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const cents = Math.round(Number(amount.replace(",", ".")) * 100) || 0;
  const basePoints = Math.round((cents / 100) * config.pointsPerReal);
  const points = kind === "extra" ? basePoints + config.bonusExtra : basePoints;

  const term = clientSearch.trim().toLowerCase();
  const filteredClients = term
    ? clients.filter((c) => c.name.toLowerCase().includes(term) || (c.phone ?? "").includes(term))
    : clients;
  const selectedClient = clients.find((c) => c.id === clientId) ?? null;

  function createClient() {
    const name = newClientName.trim();
    if (!name) return;
    const c: Client = {
      id: crypto.randomUUID(),
      name,
      phone: newClientPhone.replace(/\D/g, "") || undefined,
      createdAt: new Date().toISOString(),
    };
    onAddClient(c);
    setClientId(c.id);
    setNewClientName("");
    setNewClientPhone("");
  }

  const catalog = kind === "service" ? services : kind === "product" ? products : [];

  function pickCatalog(id: string) {
    const item = catalog.find((c) => c.id === id);
    if (!item) return;
    setLabel(item.name);
    setAmount((item.priceCents / 100).toString().replace(".", ","));
  }


  return (
    <ModalShell title={`Lançar venda · ${member.name}`} onClose={onClose}>
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
                    ? "border-brand bg-brand text-white"
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

        <div className="space-y-2 rounded-lg border border-neutral-200 p-3">
          <span className="block text-sm font-medium text-neutral-700">Cliente</span>
          <input
            value={clientSearch}
            onChange={(e) => setClientSearch(e.target.value)}
            placeholder="Buscar cliente por nome ou telefone"
            className={inputCls}
          />
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={inputCls}>
            <option value="">— sem cliente —</option>
            {filteredClients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>
            ))}
          </select>
          <details>
            <summary className="cursor-pointer text-xs font-medium text-neutral-600">Cadastrar novo cliente</summary>
            <div className="mt-2 space-y-2">
              <input
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                placeholder="Nome"
                className={inputCls}
              />
              <input
                value={newClientPhone}
                onChange={(e) => setNewClientPhone(e.target.value)}
                placeholder="Telefone (só números)"
                inputMode="tel"
                className={inputCls}
              />
              <button
                type="button"
                onClick={createClient}
                disabled={!newClientName.trim()}
                className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-800 hover:bg-neutral-50 disabled:opacity-40"
              >
                Cadastrar e selecionar
              </button>
            </div>
          </details>
        </div>

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
              clientId: selectedClient?.id,
              clientName: selectedClient?.name,
            });
            onClose();
          }}
          className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-40"
        >
          Registrar
        </button>
      </div>
    </ModalShell>
  );
}

/** Lista de clientes com jornada de compra e ranking de consumo. */
function ClientsPanel({
  clients,
  entries,
  onAddClient,
  onRemoveClient,
}: {
  clients: Client[];
  entries: Entry[];
  onAddClient: (c: Client) => void;
  onRemoveClient: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const list = clients.map((c) => {
      const es = entries
        .filter((e) => e.clientId === c.id)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return {
        client: c,
        entries: es,
        cents: es.reduce((s, e) => s + e.amountCents, 0),
        visits: es.length,
        last: es[0]?.createdAt ?? null,
      };
    });
    list.sort((a, b) => b.cents - a.cents);
    const term = search.trim().toLowerCase();
    return term
      ? list.filter((r) => r.client.name.toLowerCase().includes(term) || (r.client.phone ?? "").includes(term))
      : list;
  }, [clients, entries, search]);

  const medal = (i: number) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}º`);

  function add() {
    const n = name.trim();
    if (!n) return;
    onAddClient({
      id: crypto.randomUUID(),
      name: n,
      phone: phone.replace(/\D/g, "") || undefined,
      createdAt: new Date().toISOString(),
    });
    setName("");
    setPhone("");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do cliente" className={inputCls} />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Telefone" inputMode="tel" className={inputCls} />
          <button
            onClick={add}
            disabled={!name.trim()}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-40"
          >
            Adicionar
          </button>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar cliente"
          className={inputCls + " mt-2"}
        />
      </div>

      {rows.length === 0 && (
        <p className="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          Nenhum cliente cadastrado ainda.
        </p>
      )}

      {rows.map((r, i) => (
        <div key={r.client.id} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-neutral-100 text-sm">{medal(i)}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-neutral-900">{r.client.name}</p>
              <p className="truncate text-[11px] text-neutral-500">
                {r.client.phone ? `${r.client.phone} · ` : ""}
                {r.visits} compras · {fmtBRL(r.cents)}
                {r.last ? ` · última em ${new Date(r.last).toLocaleDateString("pt-BR")}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => setOpenId(openId === r.client.id ? null : r.client.id)}
                className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
              >
                Jornada
              </button>
              <button
                onClick={() => onRemoveClient(r.client.id)}
                className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-xs text-red-600 hover:border-red-300 hover:bg-red-50"
                title="Remover cliente"
              >
                Excluir
              </button>
            </div>
          </div>

          {openId === r.client.id && (
            <ul className="mt-3 divide-y divide-neutral-200 border-t border-neutral-200 pt-2">
              {r.entries.length === 0 && (
                <li className="py-2 text-xs text-neutral-500">Nenhuma compra registrada.</li>
              )}
              {r.entries.map((e) => (
                <li key={e.id} className="py-2 text-xs">
                  <p className="font-medium text-neutral-900">{e.label}</p>
                  <p className="text-[10px] uppercase tracking-wide text-neutral-500">
                    {e.kind === "service" ? "Serviço" : e.kind === "product" ? "Produto" : "Extra"} ·{" "}
                    {new Date(e.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} ·{" "}
                    {fmtBRL(e.amountCents)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
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
  const { confirm, dialog } = useConfirm();
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState<string | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhoto(await fileToDataUrl(f));
    e.target.value = "";
  }

  return (
    <div className="space-y-5">
      {dialog}
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Adicionar barbeiro</p>
        <div className="flex items-center gap-3">
          <Avatar member={{ id: "", name: name || "?", photo }} size={56} />
          <div className="flex flex-col gap-2">
            <input ref={fileRef} type="file" accept="image/*" onChange={onPickPhoto} className="hidden" />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:border-neutral-400"
            >
              {photo ? "Trocar foto" : "Escolher foto"}
            </button>
            {photo && (
              <button
                type="button"
                onClick={() => setPhoto(undefined)}
                className="text-[11px] text-neutral-500 hover:text-red-600"
              >
                remover foto
              </button>
            )}
          </div>
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome (ex: Bruno)"
          className={inputCls}
        />
        <button
          disabled={!name.trim()}
          onClick={() => {
            onAdd({ id: crypto.randomUUID(), name: name.trim(), photo });
            setName("");
            setPhoto(undefined);
          }}
          className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-40"
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
                <Avatar member={m} size={36} />
                <span className="flex-1 truncate text-sm font-medium text-neutral-900">{m.name}</span>
                <button
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Remover ${m.name}?`,
                      description: "Os lançamentos ficam no histórico.",
                      confirmLabel: "Remover",
                      destructive: true,
                    });
                    if (!ok) return;
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
          className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-40"
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
        className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong"
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
