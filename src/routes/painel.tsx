// Painel web do CRM — aberto em nova aba pela extensão.
//
// Auth: token da extensão passado via `?token=<raw>` na primeira abertura,
// persistido em localStorage. As chamadas à API pública `/api/public/extension/*`
// vão com Authorization: Bearer <token>. Same-origin → sem preocupação com CORS.

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { TeamView } from "@/components/team-view";
import { ConnectionView } from "@/components/connection-view";
import { QuickRepliesView } from "@/components/quick-replies-view";
import { FunnelsView } from "@/components/funnels-view";
import { DispatchCenter } from "@/components/dispatch-view";
import { sendWaAction, isRealPhone, openWhatsappChat, applyFunnelActions } from "@/lib/wa-actions";
import { sendableActions, type QuickReply } from "@/lib/quick-replies";

import { useConfirm } from "@/components/confirm-dialog";
import { toast } from "sonner";


import {
  SUBSCRIPTION_SYSTEMS,
  statusesForSystem,
  parseSubscriptionSheet,
  planFromTags,
  type SubscriptionSystemId,
} from "@/lib/subscription-systems";
import {
  formatBRL,
  mergeDetectedPlans,
  priceOf,
  readGoal,
  readPlans,
  writeGoal,
  writePlans,
  normalizePlanName,
  type Plan,
} from "@/lib/shop-settings";


export const Route = createFileRoute("/painel")({
  head: () => ({
    meta: [
      { title: "Painel do CRM — Assinaturas" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Painel de gestão de assinantes da barbearia." },
      { property: "og:title", content: "Painel do CRM — Assinaturas" },
      { property: "og:description", content: "Painel de gestão de assinantes da barbearia." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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
  notes?: string | null;

};

type Campaign = {
  id: string;
  name: string;
  status: string;
  created_at?: string;
  last_error?: string | null;
  stats: { pending: number; sent: number; failed: number };
};


type Col = { key: string; label: string };

const COLUMNS: Col[] = [
  { key: "active", label: "Ativos" },
  { key: "due_soon", label: "A vencer" },
  { key: "overdue", label: "Inadimplentes" },
  { key: "reactivate", label: "Reativar" },
  { key: "canceled", label: "Cancelados" },
];

// Kanbans da barbearia: começam nos padrões do sistema escolhido e, a partir
// do momento em que o usuário cria/exclui alguma coluna, passam a viver aqui.
function colsKey(shopId: string) { return `crm_cols_${shopId || "default"}`; }

function defaultColumns(shopId: string): Col[] {
  const allowed = statusesForSystem(readSystem(shopId));
  return allowed ? COLUMNS.filter((c) => allowed.includes(c.key)) : COLUMNS;
}

/** Colunas visíveis: customizadas pelo usuário ou padrão do sistema. */
function visibleColumns(shopId: string): Col[] {
  if (typeof window === "undefined") return defaultColumns(shopId);
  try {
    const raw = localStorage.getItem(colsKey(shopId));
    const parsed = raw ? (JSON.parse(raw) as Col[]) : null;
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch { /* ignora json inválido */ }
  return defaultColumns(shopId);
}

function writeColumns(shopId: string, cols: Col[]) {
  localStorage.setItem(colsKey(shopId), JSON.stringify(cols));
}


const TOKEN_KEY = "crm_ext_token_v1";
const EXTENSION_BRIDGE_TOKEN = "__extension_bridge__";
const EXTENSION_API_REQUEST = "crm_api_request_v180";
const EXTENSION_API_RESPONSE = "crm_api_response_v180";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const q = url.searchParams.get("token");
  if (q) {
    url.searchParams.delete("token");
    window.history.replaceState({}, "", url.toString());
    if (q === EXTENSION_BRIDGE_TOKEN) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
    localStorage.setItem(TOKEN_KEY, q);
    return q;
  }
  const stored = localStorage.getItem(TOKEN_KEY);
  if (stored === EXTENSION_BRIDGE_TOKEN) {
    localStorage.removeItem(TOKEN_KEY);
    return null;
  }
  return stored;
}

function canUseExtensionBridge() {
  return typeof window !== "undefined";
}

type ApiResult = { ok?: boolean; error?: string; [key: string]: unknown };

async function apiViaExtension(path: string, opts: RequestInit = {}): Promise<ApiResult> {
  if (!canUseExtensionBridge()) {
    return { ok: false, error: "Bridge indisponível (ambiente sem window)." };
  }
  const method = opts.method || "GET";
  const id = crypto.randomUUID();
  console.info("[CRM painel] bridge →", method, path, id);
  return await new Promise<ApiResult>((resolve) => {
    const timeout = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      console.warn("[CRM painel] bridge timeout", method, path, id);
      resolve({ ok: false, error: `Extensão não respondeu em 20s (${method} ${path}). Recarregue o WhatsApp Web e tente de novo.` });
    }, 20000);
    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.__crm !== EXTENSION_API_RESPONSE || data.id !== id) return;
      clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      console.info("[CRM painel] bridge ←", method, path, id, data.payload);
      resolve(data.payload ?? { ok: false, error: data.error || "Erro na extensão (payload vazio)" });
    }
    window.addEventListener("message", onMessage);
    window.postMessage({
      __crm: EXTENSION_API_REQUEST,
      id,
      path,
      opts: {
        method,
        headers: opts.headers || {},
        body: typeof opts.body === "string" ? opts.body : undefined,
      },
    }, window.location.origin);
  });
}

async function api(token: string, path: string, opts: RequestInit = {}) {
  if (token === EXTENSION_BRIDGE_TOKEN) {
    return await apiViaExtension(path, opts);
  }
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

function nudgeExtensionPoll() {
  if (typeof window === "undefined") return;
  window.postMessage({ __crm: "poll_now_v180" }, window.location.origin);
}

type Section = "assinantes" | "funis" | "disparo" | "respostas" | "equipe" | "conexao" | "configuracoes";
/** Sub-abas da sanfona de Assinaturas. */
type AssinTab = "visao" | "assinantes";

function IconUsers() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function IconTrophy() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
      <path d="M17 5h3v3a3 3 0 0 1-3 3" />
      <path d="M7 5H4v3a3 3 0 0 0 3 3" />
    </svg>
  );
}
function IconGear({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}
function IconChat() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 21l1.9-4.9A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z" />
    </svg>
  );
}
function IconChart() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" />
    </svg>
  );
}
function IconChevron({ className = "" }: { className?: string }) {

  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={"transition " + className}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
/** Aviãozinho — seção de Disparo. */
function IconSend() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" />
    </svg>
  );
}
/** Plug — seção de Conexão (não repetir o ícone de Assinaturas). */
function IconPlug() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2v6" /><path d="M15 2v6" />
      <path d="M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6Z" /><path d="M12 17v5" />
    </svg>
  );
}

/** Botão único "Adicionar" com as duas origens (manual e planilha). */
function AddMenu({ onManual, onSheet }: { onManual: () => void; onSheet: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="rounded-lg bg-neutral-800 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:bg-neutral-700"
      >
        Adicionar
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg">
          <button
            onMouseDown={onManual}
            className="block w-full px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100"
          >
            Manualmente
          </button>
          <button
            onMouseDown={onSheet}
            className="block w-full px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100"
          >
            Importar planilha
          </button>
        </div>
      )}
    </div>
  );
}


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

// Sistema de assinatura escolhido na configuração inicial (por barbearia).
function systemKey(shopId: string) { return `crm_subsystem_${shopId || "default"}`; }
function readSystem(shopId: string): SubscriptionSystemId | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(systemKey(shopId));
  if (v === "frisar") return "frizzar"; // migração do nome antigo
  return v === "appbarber" || v === "cashbarber" || v === "frizzar" || v === "manual" ? v : null;
}
function writeSystem(shopId: string, id: SubscriptionSystemId) {
  localStorage.setItem(systemKey(shopId), id);
}




function Painel() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const initialSection: Section = (() => {
    if (typeof window === "undefined") return "assinantes";
    const s = new URLSearchParams(window.location.search).get("section");
    if (s === "equipe" || s === "conexao" || s === "configuracoes" || s === "respostas" || s === "funis" || s === "disparo") return s;
    return "assinantes";
  })();
  const [section, setSection] = useState<Section>(initialSection);
  const [assinTab, setAssinTab] = useState<AssinTab>("assinantes");
  const [assinOpen, setAssinOpen] = useState(true);

  const [disparoTab, setDisparoTab] = useState<"novo" | "campanhas">("novo");
  // Host do cabeçalho dos funis: o seletor de funil + "novo funil" moram na
  // barra superior, mas o estado deles vive dentro do FunnelsView (portal).
  const [funisHeaderEl, setFunisHeaderEl] = useState<HTMLDivElement | null>(null);
  const [shop, setShop] = useState<{ id: string; name: string } | null>(null);
  const [brand, setBrand] = useState<Brand>({});


  useEffect(() => {
    const storedToken = getToken();
    if (storedToken) {
      setToken(storedToken);
      setReady(true);
      return;
    }
    apiViaExtension("/api/public/extension/meta")
      .then((r) => {
        if (r?.ok) setToken(EXTENSION_BRIDGE_TOKEN);
      })
      .finally(() => setReady(true));
  }, []);

  async function reload(silent = false) {
    if (!token) return;
    if (!silent) setLoading(true);
    const r = await api(token, "/api/public/extension/customers");
    if (r?.ok) setCustomers(r.customers || []);
    if (!silent) setLoading(false);
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

  // Refresh silencioso ao voltar pra seção assinantes — sem "Carregando..." piscando entre abas.
  useEffect(() => {
    if (token && section === "assinantes") reload(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

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

  const NAV_TOP: Array<{
    key: Section;
    label: string;
    icon: React.ReactNode;
    children?: Array<{ key: AssinTab; label: string }>;
  }> = [
    {
      key: "assinantes",
      label: "Assinaturas",
      icon: <IconUsers />,
      children: [
        { key: "visao", label: "Visão geral" },
        { key: "assinantes", label: "Assinantes" },
      ],
    },
    { key: "funis", label: "Funis de Vendas", icon: <IconChart /> },
    { key: "disparo", label: "Disparo", icon: <IconSend /> },
    { key: "respostas", label: "Respostas rápidas", icon: <IconChat /> },
    { key: "equipe", label: "Equipe", icon: <IconTrophy /> },

    { key: "configuracoes", label: "Configurações", icon: <IconGear /> },
    { key: "conexao", label: "Conexão", icon: <IconPlug /> },
  ];

  const navRowCls = (active: boolean) =>
    "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition " +
    (active
      ? "bg-neutral-900 text-white"
      : "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950");

  return (
    <div className="flex min-h-screen bg-neutral-100 text-neutral-900">
      {/* Sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-white text-neutral-900">
        {/* Brand card — emoldura o nome pra não parecer "solto na tela" */}
        <div className="px-3 pt-4 pb-3">
          <div className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-3 shadow-sm">
            <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-yellow-400 text-base font-bold text-neutral-900 ring-1 ring-black/10">
              {shopLogo ? <img src={shopLogo} alt="logo" className="h-full w-full object-cover" /> : shopInitial}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold tracking-[0.22em] text-neutral-500">CRM BARBER</p>
              <p className="truncate text-sm font-semibold text-neutral-950">{shopName}</p>
            </div>
          </div>
        </div>

        <div className="mx-3 mb-2 h-px bg-neutral-200" />

        <nav className="flex-1 space-y-1 px-3">
          {NAV_TOP.map((n) => {
            const active = section === n.key;
            const open = Boolean(n.children) && assinOpen;
            return (
              <div key={n.key}>
                <button
                  onClick={() => {
                    // Sanfona: no item com sub-abas, o clique alterna a expansão
                    // (e leva pra seção quando ela ainda não está ativa).
                    if (n.children) {
                      setAssinOpen((v) => (active ? !v : true));
                      if (!active) setSection(n.key);
                      return;
                    }
                    setSection(n.key);
                  }}
                  className={navRowCls(active)}
                >
                  <span className="flex h-5 w-5 items-center justify-center">{n.icon}</span>
                  <span className="flex-1 truncate">{n.label}</span>
                  <IconChevron
                    className={
                      (open ? "rotate-90 " : "") +
                      (active ? "text-white/70" : "text-neutral-400 group-hover:text-neutral-700")
                    }
                  />
                </button>
                {open && n.children && (
                  <div className="mt-1 space-y-0.5 border-l border-neutral-200 pl-3 ml-4">
                    {n.children.map((sub) => (
                      <button
                        key={sub.key}
                        onClick={() => { setSection(n.key); setAssinTab(sub.key); }}
                        className={
                          "block w-full rounded-lg px-3 py-1.5 text-left text-[13px] transition " +
                          (active && assinTab === sub.key
                            ? "bg-neutral-100 font-semibold text-neutral-900"
                            : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900")
                        }
                      >
                        {sub.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );

          })}
        </nav>


      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 z-30 flex items-center justify-between border-b border-neutral-200 bg-white text-neutral-900 px-4 py-3">
        <span className="text-[11px] font-semibold tracking-[0.22em] text-neutral-700">CRM BARBER</span>
        <div className="flex gap-1 rounded-lg bg-neutral-100 p-1">
          {NAV_TOP.map((n) => (
            <button
              key={n.key}
              onClick={() => setSection(n.key)}
              className={
                "rounded-md px-2.5 py-1 text-[11px] font-medium " +
                (section === n.key ? "bg-neutral-900 text-white" : "text-neutral-600")
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
              <div className="flex items-center gap-3 px-5 py-2.5">
                <h1 className="truncate text-[13px] font-semibold uppercase tracking-widest text-neutral-900">
                  {assinTab === "visao" ? "Visão geral" : "Assinantes"}
                </h1>
              </div>
            </header>

            <main className="px-4 py-4">
              {assinTab === "visao" && (
                <OverviewView customers={customers} shopId={shop?.id ?? "default"} />
              )}
              {assinTab === "assinantes" && (
                <KanbanView
                  customers={customers}
                  loading={loading}
                  token={token}
                  reload={reload}
                  shopId={shop?.id ?? "default"}
                  onGoSettings={() => setAssinTab("visao")}
                />
              )}
            </main>
          </>
        )}

        {section === "disparo" && token && (
          <>
            <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/95 backdrop-blur mt-14 md:mt-0">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-2.5">
                <h1 className="truncate text-[13px] font-semibold uppercase tracking-widest text-neutral-900">
                  Disparo
                </h1>
                <nav className="flex shrink-0 gap-1 rounded-lg bg-neutral-100 p-1">
                  {(["novo", "campanhas"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setDisparoTab(t)}
                      className={
                        "rounded-md px-3 py-1.5 text-xs font-medium transition " +
                        (disparoTab === t ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-900")
                      }
                    >
                      {t === "novo" ? "Novo disparo" : "Campanhas"}
                    </button>
                  ))}
                </nav>
              </div>
            </header>
            <main className="px-4 py-4">
              {disparoTab === "novo" && (
                <DispatchCenter
                  api={(path: string, opts?: RequestInit) => api(token, path, opts)}
                  customers={customers}
                  cols={visibleColumns(shop?.id ?? "default")}
                  onNeedConnection={() => setSection("conexao")}
                  onDone={() => setDisparoTab("campanhas")}
                />
              )}
              {disparoTab === "campanhas" && <CampaignsView token={token} />}
            </main>
          </>
        )}

        {section === "funis" && token && (
          <>
            <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/95 backdrop-blur mt-14 md:mt-0">
              <div className="flex items-center gap-3 px-5 py-2.5">
                <div ref={setFunisHeaderEl} className="flex min-w-0 flex-1 items-center gap-2" />
              </div>
            </header>
            <main className="px-4 py-3">
              <FunnelsView
                api={(path: string, opts?: RequestInit) => api(token, path, opts)}
                headerHost={funisHeaderEl}
              />
            </main>
          </>
        )}

        {section === "respostas" && token && (
          <main className="px-6 py-6 mt-14 md:mt-0">
            <QuickRepliesView token={token} api={(path: string, opts?: RequestInit) => api(token, path, opts)} />
          </main>
        )}

        {section === "equipe" && (

          <main className="px-6 py-6 mt-14 md:mt-0">
            <TeamView shopId={shop?.id ?? "default"} />
          </main>
        )}

        {section === "conexao" && token && (
          <main className="px-6 py-6 mt-14 md:mt-0 max-w-3xl">
            <ConnectionView api={(path: string, opts?: RequestInit) => api(token, path, opts)} />
          </main>
        )}

        {section === "configuracoes" && (
          <main className="px-6 py-6 mt-14 md:mt-0">
            <SettingsView
              brand={brand}
              fallbackName={shop?.name || ""}
              onSave={saveBrand}
              shopId={shop?.id ?? "default"}
            />
          </main>
        )}

      </div>
    </div>
  );
}


type DrawerTab = "notes" | "schedule";

function IconWhatsapp() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.4 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-1.7-.1-.4-.1-.9-.3-1.5-.6a11 11 0 0 1-4.3-3.9c-.3-.5-.8-1.3-.8-2.4s.6-1.7.8-1.9c.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.4l.8 1.9c.1.2 0 .4-.1.5l-.3.4-.3.3c-.1.1-.2.3-.1.5.2.4.7 1.2 1.4 1.8.9.8 1.6 1.1 1.9 1.2.2.1.4.1.5-.1l.7-.8c.2-.2.3-.2.5-.1l1.8.9c.2.1.4.2.4.3.1.2.1.7-.1 1.3z" />
    </svg>
  );
}
function IconNote() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6M8 13h8M8 17h5" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/** Botãozinho de ação rápida no card do lead. */
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
      type="button"
      title={title}
      disabled={disabled}
      draggable={false}
      onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="grid h-7 w-7 place-items-center rounded-md border border-neutral-200 bg-white text-neutral-600 transition hover:border-neutral-900 hover:text-neutral-900 disabled:opacity-40"
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
    if (!r?.ok) { setErr(r?.error || "Não foi possível salvar o telefone"); return; }
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
    if (!r.ok) { setErr(r.error || "Falha ao falar com a extensão"); return; }
    if (!openOnly && qr) {
      await applyFunnelActions((path, opts) => api(token, path, opts), qr.actions, {
        title: customer.name,
        phone,
      });
    }
    setFeedback(openOnly ? "Conversa aberta no WhatsApp ✔" : "Mensagem enviada ✔");
  }

  return (
    <Modal onClose={onClose} title={`WhatsApp — ${customer.name}`}>
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
                  className="whitespace-nowrap rounded-lg bg-neutral-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Salvar
                </button>
              </div>
            </div>
          )}
        </div>

        <Field label="Resposta rápida">
          <select value={selected} onChange={(e) => setSelected(e.target.value)} className={inputCls}>
            <option value="">— nenhuma (mensagem manual) —</option>
            {replies.map((q) => (
              <option key={q.id} value={q.id}>{q.title}</option>
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
            className="flex-1 rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
          >
            Abrir conversa
          </button>
          <button
            onClick={() => run(false)}
            disabled={busy || (!selected && !text.trim())}
            className="flex-1 rounded-lg bg-neutral-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {busy ? "Enviando..." : "Enviar agora"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function KanbanView({

  customers,
  loading,
  token,
  reload,
  shopId,
  onGoSettings,
}: {
  customers: Customer[];
  loading: boolean;
  token: string;
  reload: () => void;
  shopId: string;
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

  const cols = useMemo(() => visibleColumns(shopId), [shopId, showImport]);

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
    if (!r?.ok) setPending((p) => { const n = { ...p }; delete n[id]; return n; });
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

  return (
    <div className="space-y-4">
      {dialog}

      <div className="flex items-center justify-end">
        <AddMenu onSheet={() => setShowImport(true)} onManual={() => setShowAdd(true)} />
      </div>


      {loading && <p className="text-sm text-neutral-500">Carregando...</p>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {cols.map((col) => (
          <div
            key={col.key}
            onDragOver={(e) => { e.preventDefault(); setOverCol(col.key); }}
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
              (overCol === col.key ? "border-yellow-400 ring-2 ring-yellow-300/60" : "border-neutral-200")
            }
          >
            <div className="border-b border-neutral-200 px-4 py-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-700">{col.label}</h3>
              <p className="text-xs text-neutral-500">{byStatus[col.key]?.length ?? 0} contato(s)</p>
              <p className="mt-1 text-sm font-semibold text-neutral-900">{formatBRL(colTotal(col.key))}</p>
            </div>
            <div className="max-h-[calc(100vh-330px)] min-h-40 space-y-2 overflow-y-auto p-3">
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
                    onDragEnd={() => { setDragId(null); setOverCol(null); }}
                    onClick={() => setDetail(c)}
                    className={
                      "cursor-grab rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm transition hover:border-neutral-900 hover:shadow-sm active:cursor-grabbing " +
                      (dragId === c.id ? "opacity-50" : "")
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-neutral-900">{c.name}</div>
                        <div className="text-xs text-neutral-500">{phoneLabel(c.phone)}</div>
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
                            
                          >
                            <IconWhatsapp />
                          </CardAction>
                          <CardAction
                            title="Anotações"
                            onClick={() => { setDetailTab("notes"); setDetail(c); }}
                          >
                            <IconNote />
                          </CardAction>
                          <CardAction
                            title="Mensagem agendada"
                            onClick={() => { setDetailTab("schedule"); setDetail(c); }}
                          >
                            <IconClock />
                          </CardAction>
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); remove(c.id); }}
                        className="rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                        title="Remover"
                      >
                        🗑
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

      {showAdd && <AddModal token={token} cols={cols} onClose={() => { setShowAdd(false); reload(); }} />}
      {waTarget && (
        <WhatsAppActionModal
          token={token}
          customer={waTarget}
          onClose={() => setWaTarget(null)}
        />
      )}
      {detail && (
        <CustomerDrawer
          token={token}
          customer={detail}
          plans={plans}
          cols={cols}
          initialTab={detailTab}
          onOpenWhatsapp={() => { setWaTarget(detail); setDetail(null); }}
          onMove={(status) => { moveTo(detail.id, status); setDetail(null); }}
          onClose={() => { setDetail(null); reload(); }}
        />
      )}

      {showImport && (
        <ImportModal
          token={token}
          shopId={shopId}
          system={readSystem(shopId)}
          onGoSettings={() => { setShowImport(false); onGoSettings(); }}
          onClose={() => {
            setShowImport(false);
            setPending({});
            setPlans(readPlans(shopId));
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
    if (!r?.ok) { setErr(r?.error || "Erro ao salvar anotação"); return; }
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
        name: `Mensagem — ${customer.name}`,
        message: msg.trim(),
        customer_ids: [customer.id],
        scheduled_for: when ? new Date(when).toISOString() : undefined,
      }),
    });
    setBusy(false);
    if (!r?.ok) { setErr(r?.error || "Erro ao agendar"); return; }
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
                  (drawerTab === t ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-900")
                }
              >
                {t === "notes" ? "Anotações" : "Mensagens agendadas"}
              </button>
            ))}
          </div>
          {onOpenWhatsapp && (
            <button
              onClick={onOpenWhatsapp}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
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
            {cols.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
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
                className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
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
              className="w-full rounded-lg bg-neutral-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
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


function AddModal({ token, cols, onClose }: { token: string; cols: Array<{ key: string; label: string }>; onClose: () => void }) {
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
            {cols.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </Field>
        {err && <p className="text-sm text-red-500">{err}</p>}
        <button
          disabled={busy}
          className="w-full rounded-lg bg-neutral-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
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
  system,
  onGoSettings,
}: {
  token: string;
  shopId: string;
  onClose: () => void;
  system: SubscriptionSystemId | null;
  onGoSettings: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const meta = SUBSCRIPTION_SYSTEMS.find((s) => s.id === system);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !system) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const matrix = await sheetToMatrix(file);
      const report = parseSubscriptionSheet(system, matrix);
      if (!report.rows.length) {
        throw new Error(
          "Nenhuma linha válida encontrada. Confira se a planilha é a exportação do " +
            (meta?.label ?? "sistema") + " e tem colunas de nome e telefone.",
        );
      }
      const r = await api(token, "/api/public/extension/customers/import", {
        method: "POST",
        body: JSON.stringify({ customers: report.rows, mode: "replace_spreadsheet" }),
      });
      if (!r?.ok) throw new Error(r?.error || "Erro na importação");

      // Planos detectados na planilha entram no catálogo (valor a definir).
      const detected = Object.keys(report.byPlan);
      const merged = mergeDetectedPlans(shopId, detected);
      const semValor = merged.filter((p) => p.priceCents <= 0).length;

      const semTelefone = report.rows.filter((r) => r.tags.includes("sem-telefone")).length;

      const dist = COLUMNS
        .filter((c) => report.byStatus[c.key])
        .map((c) => `${c.label}: ${report.byStatus[c.key]}`)
        .join(" · ");
      setResult(
        `Linhas lidas: ${report.total} · Importadas: ${report.rows.length}` +
          (report.skipped ? ` · Ignoradas (sem telefone/status): ${report.skipped}` : "") +
          `\nNovos: ${r.inserted} · Atualizados: ${r.updated}` +
          (r.archived ? ` · Removidos da planilha antiga: ${r.archived}` : "") +
          (dist ? `\n${dist}` : "") +
          (detected.length ? `\nPlanos detectados: ${detected.join(" · ")}` : "") +
          (semValor ? `\n${semValor} plano(s) sem valor — cadastre em Configurações.` : "") +
          (semTelefone
            ? `\n${semTelefone} assinante(s) sem telefone na planilha — entram no Kanban, mas ficam fora dos disparos.`
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
            className="w-full rounded-lg bg-neutral-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700"
          >
            Ir para Configurações
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} title={`Importar planilha — ${meta?.label ?? ""}`}>
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
              className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
            >
              Escolher arquivo
            </button>
            <span className="truncate text-xs text-neutral-500">
              {file ? file.name : "Nenhum arquivo selecionado"}
            </span>
          </div>
        </Field>


        {err && <p className="text-sm text-red-500">{err}</p>}
        {result && <p className="whitespace-pre-line text-sm text-emerald-600">{result}</p>}
        <button
          disabled={busy || !file}
          className="w-full rounded-lg bg-neutral-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {busy ? "Importando..." : "Importar e organizar"}
        </button>
      </form>
    </Modal>
  );
}



// O formulário de disparo agora vive na seção "Disparo" (src/components/dispatch-view.tsx).


// Cache module-scoped: sobrevive à troca de aba, evita "Carregando..." piscando.
const campaignsCache: Record<string, Campaign[] | undefined> = {};


function CampaignsView({ token, scope }: { token: string; scope?: "assinaturas" | "funil" }) {
  const { confirm, dialog } = useConfirm();
  const cacheKey = scope ?? "todos";
  const [campaigns, setCampaigns] = useState<Campaign[]>(campaignsCache[cacheKey] ?? []);
  const [loaded, setLoaded] = useState<boolean>(campaignsCache[cacheKey] !== undefined);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function reload() {
    const r = await api(token, `/api/public/extension/campaigns${scope ? `?scope=${scope}` : ""}`);
    if (r?.ok) {
      const list: Campaign[] = r.campaigns || [];
      campaignsCache[cacheKey] = list;
      setCampaigns(list);
    }
    setLoaded(true);
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
    const ok = await confirm({
      title: `Cancelar campanha "${c.name}"?`,
      description: "Os jobs pendentes não serão disparados.",
      confirmLabel: "Cancelar campanha",
      cancelLabel: "Voltar",
      destructive: true,
    });
    if (!ok) return;
    await api(token, `/api/public/extension/campaigns/${c.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "canceled" }),
    });
    reload();
  }

  async function deleteCamp(c: Campaign) {
    const ok = await confirm({
      title: `Apagar a campanha "${c.name}"?`,
      description: "Remove a campanha e todos os jobs dela do histórico. Não dá pra desfazer.",
      confirmLabel: "Apagar",
      destructive: true,
    });
    if (!ok) return;
    await api(token, `/api/public/extension/campaigns/${c.id}`, { method: "DELETE" });
    reload();
  }

  if (!loaded && campaigns.length === 0) return null;

  return (
    <div className="space-y-3">
      {dialog}

      {loaded && campaigns.length === 0 && (
        <p className="text-sm text-neutral-500">Nenhuma campanha criada ainda.</p>
      )}
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
                {c.created_at && (
                  <p className="mt-0.5 text-[11px] text-neutral-400">
                    Criada em {new Date(c.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {!isFinal && (
                  <button
                    onClick={() => toggleStatus(c)}
                    className={
                      "rounded-lg px-3 py-1.5 text-sm font-semibold " +
                      (isRunning
                        ? "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
                        : "bg-neutral-800 text-white hover:bg-neutral-700")
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

/** Configurações da assinatura (sistema, planos e meta) — abre pela engrenagem. */
/**
 * Visão geral das assinaturas: gamificação da meta + configurações
 * (sistema, planos e meta). Antes era um modal; virou sub-aba.
 */
function OverviewView({ customers, shopId }: { customers: Customer[]; shopId: string }) {
  const [system, setSystem] = useState<SubscriptionSystemId | "">(() => readSystem(shopId) ?? "");
  const [plans, setPlans] = useState<Plan[]>(() => readPlans(shopId));
  const [newPlan, setNewPlan] = useState("");
  const [goal, setGoal] = useState<number>(() => readGoal(shopId));

  const actives = customers.filter((c) => c.status === "active" || c.status === "due_soon");
  const totalSubs = actives.length;
  const missing = Math.max(0, goal - totalSubs);
  const pct = goal > 0 ? Math.min(100, Math.round((totalSubs / goal) * 100)) : 0;
  const mrr = actives.reduce((sum, c) => sum + priceOf(plans, planFromTags(c.tags)), 0);

  function saveSystem(id: SubscriptionSystemId) {
    setSystem(id);
    writeSystem(shopId, id);
  }

  function persistPlans(next: Plan[]) {
    setPlans(next);
    writePlans(shopId, next);
  }

  function addPlan() {
    const name = newPlan.trim();
    if (!name) return;
    if (plans.some((p) => normalizePlanName(p.name) === normalizePlanName(name))) {
      setNewPlan("");
      return;
    }
    persistPlans([...plans, { name, priceCents: 0 }]);
    setNewPlan("");
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      {/* Meta do mês — o número de assinantes é o herói do card */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-neutral-500">
              Assinantes ativos
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-6xl font-bold leading-none tracking-tight text-neutral-950">{totalSubs}</span>
              {goal > 0 && <span className="text-xl font-medium text-neutral-400">/ {goal}</span>}
            </div>
            <p className="mt-2 text-sm font-medium text-neutral-600">
              {goal > 0
                ? missing > 0
                  ? `Faltam ${missing} para bater a meta`
                  : "Meta do mês batida 🎉"
                : "Defina uma meta do mês abaixo"}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-neutral-400">
              Receita recorrente
            </p>
            <p className="text-base font-semibold text-neutral-600">{formatBRL(mrr)}</p>
          </div>
        </div>
        <div className="mt-5">
          <div className="h-3 w-full overflow-hidden rounded-full bg-neutral-100">
            <div className="h-full rounded-full bg-yellow-400 transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 text-right text-xs font-semibold text-neutral-500">{pct}%</p>
        </div>
      </div>


      <div className="space-y-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">


        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Sistema</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {SUBSCRIPTION_SYSTEMS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => saveSystem(s.id)}
                className={
                  "rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition " +
                  (system === s.id
                    ? "border-neutral-800 bg-neutral-800 text-white"
                    : "border-neutral-200 bg-white text-neutral-800 hover:border-neutral-400")
                }
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Planos e valores</h3>
          {plans.length === 0 && <p className="text-xs text-neutral-400">Nenhum plano ainda.</p>}
          {plans.map((p, i) => (
            <div key={p.name + i} className="flex items-center gap-2">
              <input
                value={p.name}
                onChange={(e) => {
                  const next = [...plans];
                  next[i] = { ...next[i], name: e.target.value };
                  setPlans(next);
                }}
                onBlur={() => persistPlans(plans)}
                className={inputCls}
              />
              <input
                type="number"
                min={0}
                step="0.01"
                value={p.priceCents ? (p.priceCents / 100).toString() : ""}
                placeholder="0,00"
                onChange={(e) => {
                  const next = [...plans];
                  next[i] = { ...next[i], priceCents: Math.round(Number(e.target.value || 0) * 100) };
                  setPlans(next);
                }}
                onBlur={() => persistPlans(plans)}
                className={inputCls + " w-28"}
              />
              <button
                type="button"
                onClick={() => persistPlans(plans.filter((_, j) => j !== i))}
                className="rounded p-2 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                title="Remover plano"
              >
                🗑
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <input
              value={newPlan}
              onChange={(e) => setNewPlan(e.target.value)}
              placeholder="Novo plano"
              className={inputCls}
            />
            <button
              type="button"
              onClick={addPlan}
              className="shrink-0 rounded-lg bg-neutral-800 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700"
            >
              Adicionar
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Meta do mês</h3>
          <input
            type="number"
            min={0}
            value={goal || ""}
            placeholder="Ex.: 200"
            onChange={(e) => setGoal(Number(e.target.value || 0))}
            onBlur={() => writeGoal(shopId, goal)}
            className={inputCls + " max-w-40"}
          />
        </div>

        <button
          onClick={() => { writeGoal(shopId, goal); persistPlans(plans); }}
          className="w-full rounded-lg bg-neutral-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700"
        >
          Salvar
        </button>
      </div>
    </div>
  );
}

function SettingsView({
  brand,
  fallbackName,
  onSave,
}: {
  brand: Brand;
  fallbackName: string;
  onSave: (b: Brand) => void;
  shopId: string;
}) {
  const [name, setName] = useState(brand.name || fallbackName || "");
  const [logo, setLogo] = useState(brand.logo || "");
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function pickLogo(file: File) {
    if (file.size > 400_000) {
      toast.error("Logo muito grande. Use uma imagem até 400KB.");
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
          <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-2xl bg-neutral-800 text-2xl font-semibold text-white shadow-sm">
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
            className="rounded-lg bg-neutral-800 px-5 py-2 text-sm font-semibold text-white hover:bg-neutral-700"
          >
            Salvar
          </button>
          {saved && <span className="text-xs font-medium text-emerald-600">Salvo ✔</span>}
        </div>
      </div>
    </div>
  );
}
