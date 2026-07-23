// Painel web do CRM — aberto em nova aba pela extensão.
//
// Auth: token da extensão passado via `?token=<raw>` na primeira abertura,
// persistido em localStorage. As chamadas à API pública `/api/public/extension/*`
// vão com Authorization: Bearer <token>. Same-origin → sem preocupação com CORS.

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { TeamView } from "@/components/team-view";

export const Route = createFileRoute("/painel")({
  head: () => ({
    meta: [
      { title: "Painel do CRM — Assinaturas" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Painel de gestão de assinantes da barbearia." },
    ],
  }),
  component: Painel,
});

type Customer = {
  id: string;
  name: string;
  phone: string;
  status: string;
  tags: string[] | null;
  source: string;
  archived_at: string | null;
};

type Campaign = {
  id: string;
  name: string;
  status: string;
  stats: { pending: number; sent: number; failed: number };
};

const COLUMNS: Array<{ key: string; label: string }> = [
  { key: "active", label: "Ativos" },
  { key: "overdue", label: "Inadimplentes" },
  { key: "reactivate", label: "Reativar" },
  { key: "canceled", label: "Cancelados" },
];

const TOKEN_KEY = "crm_ext_token_v1";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const q = url.searchParams.get("token");
  if (q) {
    localStorage.setItem(TOKEN_KEY, q);
    url.searchParams.delete("token");
    window.history.replaceState({}, "", url.toString());
    return q;
  }
  return localStorage.getItem(TOKEN_KEY);
}

async function api(token: string, path: string, opts: RequestInit = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: `HTTP ${res.status}` };
  }
}

type Section = "assinantes" | "equipe" | "configuracoes";
type AssinantesTab = "kanban" | "disparo" | "campanhas";

type Brand = { name?: string; logo?: string };
function brandKey(shopId: string) { return `crm_brand_${shopId || "default"}`; }
function readBrand(shopId: string): Brand {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(brandKey(shopId)) || "{}") || {}; }
  catch { return {}; }
}
function writeBrand(shopId: string, data: Brand) {
  localStorage.setItem(brandKey(shopId), JSON.stringify(data));
}


function Painel() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const initialSection: Section = (() => {
    if (typeof window === "undefined") return "assinantes";
    const s = new URLSearchParams(window.location.search).get("section");
    if (s === "equipe" || s === "configuracoes") return s;
    return "assinantes";
  })();
  const [section, setSection] = useState<Section>(initialSection);
  const [tab, setTab] = useState<AssinantesTab>("kanban");
  const [shop, setShop] = useState<{ id: string; name: string } | null>(null);
  const [brand, setBrand] = useState<Brand>({});


  useEffect(() => {
    setToken(getToken());
    setReady(true);
  }, []);

  async function reload() {
    if (!token) return;
    setLoading(true);
    const r = await api(token, "/api/public/extension/customers");
    if (r?.ok) setCustomers(r.customers || []);
    setLoading(false);
  }

  useEffect(() => {
    if (!token) return;
    reload();
    api(token, "/api/public/extension/meta").then((r) => {
      if (r?.ok && r.barbershop) {
        setShop(r.barbershop);
        setBrand(readBrand(r.barbershop.id));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (token && section === "assinantes") reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, section]);

  if (!ready) return null;

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-yellow-50 p-6">
        <div className="max-w-md rounded-lg border border-yellow-500/30 bg-neutral-900 p-8 text-center">
          <h1 className="text-2xl font-bold text-yellow-400">Painel bloqueado</h1>
          <p className="mt-3 text-sm text-neutral-300">
            Abra este painel pela extensão do CRM no WhatsApp Web — o botão manda
            você pra cá já autenticado.
          </p>
        </div>
      </div>
    );
  }

  const shopName = brand.name || shop?.name || "Sua barbearia";
  const shopInitial = shopName.trim().charAt(0).toUpperCase() || "B";
  const shopLogo = brand.logo || "";

  function saveBrand(next: Brand) {
    if (!shop?.id) return;
    writeBrand(shop.id, next);
    setBrand(next);
  }

  const NAV_TOP: Array<{ key: Section; label: string }> = [
    { key: "assinantes", label: "Assinantes" },
    { key: "equipe", label: "Equipe" },
  ];

  const navBtnCls = (active: boolean) =>
    "w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition " +
    (active
      ? "bg-neutral-900 text-yellow-400 shadow-sm"
      : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900");


  return (
    <div className="flex min-h-screen bg-neutral-100 text-neutral-900">
      {/* Sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-white">
        <div className="flex items-center gap-3 px-5 py-5 border-b border-neutral-200">
          <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-lg bg-neutral-900 text-sm font-semibold text-yellow-400">
            {shopLogo ? <img src={shopLogo} alt="logo" className="h-full w-full object-cover" /> : shopInitial}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-neutral-500">CRM BARBER</p>
            <p className="truncate text-sm font-medium text-neutral-900">{shopName}</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 pt-4">
          {NAV_TOP.map((n) => (
            <button
              key={n.key}
              onClick={() => setSection(n.key)}
              className={navBtnCls(section === n.key)}
            >
              {n.label}
            </button>
          ))}
        </nav>

        <div className="px-3 pb-4">
          <button
            onClick={() => setSection("configuracoes")}
            className={navBtnCls(section === "configuracoes")}
          >
            Configurações
          </button>
        </div>
      </aside>


      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 z-30 flex items-center justify-between border-b border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur">
        <span className="text-xs font-semibold tracking-[0.2em] text-neutral-900">CRM BARBER</span>
        <div className="flex gap-1 rounded-lg bg-neutral-100 p-1">
          {[...NAV_TOP, { key: "configuracoes" as Section, label: "Config" }].map((n) => (
            <button
              key={n.key}
              onClick={() => setSection(n.key)}
              className={
                "rounded-md px-2.5 py-1 text-[11px] font-medium " +
                (section === n.key ? "bg-neutral-900 text-yellow-400" : "text-neutral-600")
              }
            >
              {n.label}
            </button>
          ))}
        </div>
      </div>




      {/* Content */}
      <div className="flex-1 min-w-0">
        {section === "assinantes" && (
          <>
            <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/95 backdrop-blur mt-14 md:mt-0">
              <div className="flex flex-wrap items-center justify-end gap-4 px-6 py-4">
                <nav className="flex gap-1 rounded-lg bg-neutral-100 p-1">
                  {(["kanban", "disparo", "campanhas"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className={
                        "rounded-md px-3 py-1.5 text-xs font-medium transition " +
                        (tab === t ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-900")
                      }
                    >
                      {t === "kanban" ? "Kanban" : t === "disparo" ? "Novo disparo" : "Campanhas"}
                    </button>
                  ))}
                </nav>
              </div>
            </header>


            <main className="px-6 py-6">
              {tab === "kanban" && (
                <KanbanView customers={customers} loading={loading} token={token} reload={reload} />
              )}
              {tab === "disparo" && (
                <DisparoView customers={customers} token={token} onDone={() => setTab("campanhas")} />
              )}
              {tab === "campanhas" && <CampaignsView token={token} />}
            </main>
          </>
        )}

        {section === "equipe" && (
          <main className="px-6 py-6 mt-14 md:mt-0">
            <TeamView shopId={shop?.id ?? "default"} />
          </main>
        )}

        {section === "configuracoes" && (
          <main className="px-6 py-6 mt-14 md:mt-0">
            <SettingsView
              brand={brand}
              fallbackName={shop?.name || ""}
              onSave={saveBrand}
            />
          </main>
        )}

      </div>
    </div>
  );
}


function KanbanView({
  customers,
  loading,
  token,
  reload,
}: {
  customers: Customer[];
  loading: boolean;
  token: string;
  reload: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const byStatus = useMemo(() => {
    const g: Record<string, Customer[]> = {};
    for (const col of COLUMNS) g[col.key] = [];
    for (const c of customers) {
      if (!g[c.status]) g[c.status] = [];
      g[c.status].push(c);
    }
    return g;
  }, [customers]);

  async function moveTo(id: string, status: string) {
    await api(token, `/api/public/extension/customers/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    reload();
  }

  async function remove(id: string) {
    if (!confirm("Remover este contato do CRM? (fica arquivado no histórico)")) return;
    await api(token, `/api/public/extension/customers/${id}`, { method: "DELETE" });
    reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          onClick={() => setShowImport(true)}
          className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
        >
          Importar planilha
        </button>
        <button
          onClick={() => setShowAdd(true)}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-yellow-400 hover:bg-neutral-800"
        >
          + Adicionar contato
        </button>
      </div>

      {loading && <p className="text-sm text-neutral-500">Carregando...</p>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {COLUMNS.map((col) => (
          <div key={col.key} className="rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-700">{col.label}</h3>
                <p className="text-xs text-neutral-500">{byStatus[col.key]?.length ?? 0} contato(s)</p>
              </div>
            </div>
            <div className="space-y-2 p-3 min-h-40">
              {(byStatus[col.key] ?? []).map((c) => (
                <div
                  key={c.id}
                  className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm hover:border-neutral-900 hover:shadow-sm transition"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-neutral-900">{c.name}</div>
                      <div className="text-xs text-neutral-500">{c.phone}</div>
                      {c.source === "spreadsheet" ? (
                        <span className="mt-1 inline-block rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] uppercase text-yellow-400">
                          planilha
                        </span>
                      ) : (
                        <span className="mt-1 inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] uppercase text-emerald-700">
                          manual
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => remove(c.id)}
                      className="rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                      title="Remover"
                    >
                      🗑
                    </button>
                  </div>
                  <select
                    value={c.status}
                    onChange={(e) => moveTo(c.id, e.target.value)}
                    className="mt-2 w-full rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700"
                  >
                    {COLUMNS.map((cc) => (
                      <option key={cc.key} value={cc.key}>Mover para: {cc.label}</option>
                    ))}
                  </select>
                </div>
              ))}
              {(byStatus[col.key]?.length ?? 0) === 0 && (
                <p className="p-3 text-center text-xs text-neutral-400">Vazio</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {showAdd && <AddModal token={token} onClose={() => { setShowAdd(false); reload(); }} />}
      {showImport && <ImportModal token={token} onClose={() => { setShowImport(false); reload(); }} />}
    </div>
  );
}

function AddModal({ token, onClose }: { token: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState("active");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;
    setBusy(true);
    setErr(null);
    const r = await api(token, "/api/public/extension/customers", {
      method: "POST",
      body: JSON.stringify({ name: name.trim(), phone: phone.trim(), status, tags: [] }),
    });
    setBusy(false);
    if (!r?.ok) { setErr(r?.error || "Erro"); return; }
    onClose();
  }

  return (
    <Modal onClose={onClose} title="Adicionar contato">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Nome">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} required />
        </Field>
        <Field label="Telefone (com DDD)">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} required />
        </Field>
        <Field label="Coluna">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
            {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </Field>
        {err && <p className="text-sm text-red-400">{err}</p>}
        <button
          disabled={busy}
          className="w-full rounded-md bg-yellow-400 px-4 py-2 font-bold text-neutral-950 hover:bg-yellow-300 disabled:opacity-50"
        >
          {busy ? "Salvando..." : "Adicionar"}
        </button>
      </form>
    </Modal>
  );
}

function ImportModal({ token, onClose }: { token: string; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("active");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text, status);
      if (!rows.length) throw new Error("Nenhuma linha válida. Use CSV com colunas: nome;telefone");
      const r = await api(token, "/api/public/extension/customers/import", {
        method: "POST",
        body: JSON.stringify({ customers: rows, mode: "replace_spreadsheet" }),
      });
      if (!r?.ok) throw new Error(r?.error || "Erro na importação");
      setResult(
        `Recebido: ${r.received} · Novos: ${r.inserted} · Atualizados: ${r.updated}` +
        (r.archived ? ` · Substituídos da planilha antiga: ${r.archived}` : ""),
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Importar planilha">
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-md border border-yellow-500/20 bg-neutral-950 p-3 text-xs text-neutral-300">
          <div><strong className="text-yellow-400">Formato:</strong> CSV com 2 colunas — <code>nome</code> e <code>telefone</code>.</div>
          <pre className="mt-2 rounded bg-neutral-900 p-2 text-[11px]">nome;telefone{"\n"}João Silva;61999998888{"\n"}Maria Souza;5561988887777</pre>
        </div>

        <Field label="Arquivo (.csv)">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="hidden"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-md border border-yellow-500/40 bg-neutral-950 px-4 py-2 text-sm font-medium text-yellow-300 hover:bg-neutral-800"
            >
              📎 Escolher arquivo
            </button>
            <span className="truncate text-xs text-neutral-400">
              {file ? file.name : "Nenhum arquivo selecionado"}
            </span>
          </div>
        </Field>

        <Field label="Todos os contatos entram na coluna">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
            {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </Field>

        <p className="text-xs text-neutral-500">
          Ao importar, a planilha anterior é substituída. Contatos adicionados manualmente são preservados.
        </p>

        {err && <p className="text-sm text-red-400">{err}</p>}
        {result && <p className="text-sm text-green-400">{result}</p>}
        <button
          disabled={busy || !file}
          className="w-full rounded-md bg-yellow-400 px-4 py-2 font-bold text-neutral-950 hover:bg-yellow-300 disabled:opacity-50"
        >
          {busy ? "Importando..." : "Substituir planilha"}
        </button>
      </form>
    </Modal>
  );
}

function DisparoView({
  customers,
  token,
  onDone,
}: {
  customers: Customer[];
  token: string;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [variants, setVariants] = useState<string[]>([""]);
  const [segment, setSegment] = useState<string>("overdue");
  const [paceMin, setPaceMin] = useState(20);
  const [paceMax, setPaceMax] = useState(60);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const total = segment === "all"
    ? customers.length
    : customers.filter((c) => c.status === segment).length;

  function updateVariant(i: number, v: string) {
    setVariants((prev) => prev.map((x, idx) => (idx === i ? v : x)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = variants.map((v) => v.trim()).filter(Boolean);
    if (!name.trim() || cleaned.length === 0) {
      setErr("Preencha nome e ao menos 1 mensagem.");
      return;
    }
    setBusy(true);
    setErr(null);
    const r = await api(token, "/api/public/extension/campaigns", {
      method: "POST",
      body: JSON.stringify({
        name: name.trim(),
        message_variants: cleaned,
        pace_seconds_min: Math.min(paceMin, paceMax),
        pace_seconds_max: Math.max(paceMin, paceMax),
        filter: segment === "all" ? {} : { status: segment },
      }),
    });
    setBusy(false);
    if (!r?.ok) { setErr(r?.error || "Erro"); return; }
    onDone();
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-5 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-neutral-900">Novo disparo</h2>

      <Field label="Nome interno da campanha">
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="ex: Cobrança julho" required />
      </Field>

      <Field label="Público-alvo">
        <select value={segment} onChange={(e) => setSegment(e.target.value)} className={inputCls}>
          {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label} ({customers.filter((cu) => cu.status === c.key).length})</option>)}
          <option value="all">Todos ({customers.length})</option>
        </select>
        <p className="mt-1 text-xs text-neutral-500">
          Vai disparar para <strong className="text-neutral-900">{total}</strong> contato(s).
        </p>
      </Field>

      <div>
        <label className="mb-2 block text-sm font-medium text-neutral-700">
          Variações de mensagem (rotacionadas por contato — reduz chance de bloqueio)
        </label>
        <div className="space-y-2">
          {variants.map((v, i) => (
            <div key={i} className="flex gap-2">
              <textarea
                value={v}
                onChange={(e) => updateVariant(i, e.target.value)}
                rows={3}
                placeholder={`Variação ${i + 1}`}
                className={inputCls}
              />
              {variants.length > 1 && (
                <button
                  type="button"
                  onClick={() => setVariants((p) => p.filter((_, idx) => idx !== i))}
                  className="rounded px-2 text-red-500 hover:bg-red-50"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        {variants.length < 3 && (
          <button
            type="button"
            onClick={() => setVariants((p) => [...p, ""])}
            className="mt-2 text-xs font-medium text-neutral-700 hover:underline"
          >
            + Adicionar variação (máx 3)
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Ritmo mínimo (seg)">
          <input type="number" min={5} max={600} value={paceMin} onChange={(e) => setPaceMin(Number(e.target.value))} className={inputCls} />
        </Field>
        <Field label="Ritmo máximo (seg)">
          <input type="number" min={5} max={600} value={paceMax} onChange={(e) => setPaceMax(Number(e.target.value))} className={inputCls} />
        </Field>
      </div>
      <p className="-mt-3 text-xs text-neutral-500">
        Cada mensagem sai com espaçamento aleatório dentro dessa faixa.
      </p>

      {err && <p className="text-sm text-red-500">{err}</p>}
      <button
        disabled={busy}
        className="w-full rounded-lg bg-neutral-900 px-4 py-3 text-sm font-semibold text-yellow-400 hover:bg-neutral-800 disabled:opacity-50"
      >
        {busy ? "Criando..." : segment === "overdue" ? "Iniciar cobrança" : "Iniciar disparo"}
      </button>
    </form>
  );
}

function CampaignsView({ token }: { token: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function reload() {
    const r = await api(token, "/api/public/extension/campaigns");
    if (r?.ok) setCampaigns(r.campaigns || []);
    setLoading(false);
  }

  useEffect(() => {
    reload();
    timerRef.current = setInterval(reload, 4000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleStatus(c: Campaign) {
    const next = c.status === "running" ? "paused" : "running";
    await api(token, `/api/public/extension/campaigns/${c.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: next }),
    });
    reload();
  }

  async function cancelCamp(c: Campaign) {
    if (!confirm(`Cancelar campanha "${c.name}"? Jobs pendentes não serão disparados.`)) return;
    await api(token, `/api/public/extension/campaigns/${c.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "canceled" }),
    });
    reload();
  }

  async function deleteCamp(c: Campaign) {
    if (!confirm(`Apagar a campanha "${c.name}"? Isso remove a campanha e todos os jobs dela do histórico. Não dá pra desfazer.`)) return;
    await api(token, `/api/public/extension/campaigns/${c.id}`, { method: "DELETE" });
    reload();
  }

  if (loading) return <p className="text-neutral-400">Carregando...</p>;
  if (!campaigns.length) {
    return <p className="text-neutral-400">Nenhuma campanha criada ainda.</p>;
  }

  return (
    <div className="space-y-3">
      {campaigns.map((c) => {
        const total = c.stats.pending + c.stats.sent + c.stats.failed;
        const done = c.stats.sent + c.stats.failed;
        const pct = total ? Math.round((done / total) * 100) : 0;
        const isRunning = c.status === "running";
        const isPaused = c.status === "paused";
        const isFinal = c.status === "canceled" || (total > 0 && c.stats.pending === 0);
        return (
          <div key={c.id} className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-neutral-900">{c.name}</h3>
                <p className="text-xs uppercase tracking-wide text-neutral-500">
                  {c.status === "running" ? "Em andamento" : c.status === "paused" ? "Pausada" : c.status === "canceled" ? "Cancelada" : c.status}
                </p>
              </div>
              <div className="flex gap-2">
                {!isFinal && (
                  <button
                    onClick={() => toggleStatus(c)}
                    className={
                      "rounded-lg px-3 py-1.5 text-sm font-semibold " +
                      (isRunning
                        ? "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
                        : "bg-neutral-900 text-yellow-400 hover:bg-neutral-800")
                    }
                  >
                    {isRunning ? "Pausar" : "Retomar"}
                  </button>
                )}
                {!isFinal && (
                  <button
                    onClick={() => cancelCamp(c)}
                    className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-600 hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                  >
                    Cancelar
                  </button>
                )}
                <button
                  onClick={() => deleteCamp(c)}
                  title="Apagar campanha"
                  className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-400 hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                >
                  🗑
                </button>
              </div>
            </div>
            <div className="mt-4">
              <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                <div className="h-full bg-yellow-400 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-xs text-neutral-500">
                <span>{done} / {total} enviados · {c.stats.failed} falhas {isPaused ? "· pausada" : ""}</span>
                <span>{pct}%</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Utils ---

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/10";

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

// CSV parser: aceita ; , ou tab, com/sem cabeçalho, colunas nome/telefone.
function parseCsv(text: string, defaultStatus: string): Array<{ name: string; phone: string; status: string; tags: string[] }> {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || "";
  const counts = { ";": (firstLine.match(/;/g) || []).length, ",": (firstLine.match(/,/g) || []).length, "\t": (firstLine.match(/\t/g) || []).length } as Record<string, number>;
  const delim = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0]) || ",";

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  const split = (line: string) => line.split(delim).map((c) => c.trim().replace(/^"|"$/g, ""));
  const firstCells = split(lines[0]);
  const hasHeader = !firstCells.some((c) => /\d{8,}/.test(c.replace(/\D+/g, "")));

  let iName = 0, iPhone = 1;
  let start = 0;
  if (hasHeader) {
    start = 1;
    const norm = firstCells.map((h) => h.toLowerCase());
    const find = (...keys: string[]) => {
      for (const k of keys) {
        const idx = norm.findIndex((h) => h.includes(k));
        if (idx >= 0) return idx;
      }
      return -1;
    };
    const n = find("nome", "name", "contato");
    const p = find("telefone", "phone", "celular", "whatsapp", "numero");
    if (n >= 0) iName = n;
    if (p >= 0) iPhone = p;
  }

  const out: Array<{ name: string; phone: string; status: string; tags: string[] }> = [];
  for (let i = start; i < lines.length; i++) {
    const cells = split(lines[i]);
    let phone = "";
    let name = "";
    if (cells.length === 1) {
      phone = cells[0].replace(/\D+/g, "");
      name = `Contato ${phone.slice(-4)}`;
    } else {
      name = (cells[iName] || "").trim();
      phone = (cells[iPhone] || "").replace(/\D+/g, "");
      if (!name) name = `Contato ${phone.slice(-4)}`;
    }
    if (phone.length < 8) continue;
    out.push({ name, phone, status: defaultStatus, tags: [] });
  }
  return out;
}

function SettingsView({
  brand,
  fallbackName,
  onSave,
}: {
  brand: Brand;
  fallbackName: string;
  onSave: (b: Brand) => void;
}) {
  const [name, setName] = useState(brand.name || fallbackName || "");
  const [logo, setLogo] = useState(brand.logo || "");
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function pickLogo(file: File) {
    if (file.size > 400_000) {
      alert("Logo muito grande. Use uma imagem até 400KB.");
      return;
    }
    const dataUrl: string = await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.readAsDataURL(file);
    });
    setLogo(dataUrl);
  }

  function save() {
    onSave({ name: name.trim() || undefined, logo: logo || undefined });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  const initial = (name || "B").trim().charAt(0).toUpperCase();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-lg font-semibold text-neutral-900">Configurações</h1>

      <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm space-y-6">
        <div className="flex items-center gap-4">
          <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-2xl bg-neutral-900 text-2xl font-semibold text-yellow-400 shadow-sm">
            {logo ? <img src={logo} alt="logo" className="h-full w-full object-cover" /> : initial}
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
            >
              {logo ? "Trocar logo" : "Enviar logo"}
            </button>
            {logo && (
              <button
                type="button"
                onClick={() => setLogo("")}
                className="text-xs text-neutral-500 hover:text-red-600"
              >
                remover logo
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pickLogo(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        <label className="block space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">Nome da barbearia</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Barbearia do João"
            className={inputCls}
          />
        </label>

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-semibold text-yellow-400 hover:bg-neutral-800"
          >
            Salvar
          </button>
          {saved && <span className="text-xs font-medium text-emerald-600">Salvo ✔</span>}
        </div>
      </div>
    </div>
  );
}
