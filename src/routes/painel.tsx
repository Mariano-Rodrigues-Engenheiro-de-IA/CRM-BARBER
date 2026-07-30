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
import { sendWaAction, isRealPhone } from "@/lib/wa-actions";
import type { QuickReply } from "@/lib/quick-replies";
import { PREMIUM_PRICE_LABEL, type BillingStatus } from "@/lib/billing";
import { useConfirm } from "@/components/confirm-dialog";
import { toast } from "sonner";

/** Faixa de plano: mostra uso do grátis e leva pro checkout Premium. */
function PlanBanner({ billing, shopId }: { billing: BillingStatus | null; shopId?: string }) {
  if (!billing) return null;
  if (billing.premium) {
    return (
      <div className="mx-6 mt-4 flex items-center justify-between rounded-xl border border-yellow-400/60 bg-yellow-50 px-4 py-2.5 text-sm">
        <span className="font-medium text-neutral-900">Plano Premium ativo — sem limites.</span>
      </div>
    );
  }
  const restCustomers = Math.max(0, billing.limits.customers - billing.usage.customers);
  const restMessages = Math.max(0, billing.limits.messages - billing.usage.messages);
  return (
    <div className="mx-6 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-900/10 bg-neutral-900 px-4 py-3 text-sm text-neutral-100">
      <div>
        <p className="font-semibold text-yellow-400">Plano grátis</p>
        <p className="text-xs text-neutral-300">
          Restam {restCustomers} assinantes e {restMessages} mensagens. Depois disso o disparo trava.
        </p>
      </div>
      <a
        href={shopId ? `/assinar?shop=${shopId}` : "/assinar"}
        target="_blank"
        rel="noreferrer"
        className="rounded-lg bg-yellow-400 px-4 py-2 text-xs font-bold text-neutral-900 hover:bg-yellow-300"
      >
        COMPRAR PREMIUM · {PREMIUM_PRICE_LABEL}
      </a>
    </div>
  );
}

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


const COLUMNS: Array<{ key: string; label: string }> = [
  { key: "active", label: "Ativos" },
  { key: "due_soon", label: "A vencer" },
  { key: "overdue", label: "Inadimplentes" },
  { key: "reactivate", label: "Reativar" },
  { key: "canceled", label: "Cancelados" },
];

/** Colunas visíveis conforme o sistema de assinatura escolhido. */
function visibleColumns(shopId: string) {
  const allowed = statusesForSystem(readSystem(shopId));
  return allowed ? COLUMNS.filter((c) => allowed.includes(c.key)) : COLUMNS;
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

type Section = "assinantes" | "funis" | "respostas" | "equipe" | "conexao" | "configuracoes";

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
function IconGear() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
    if (s === "equipe" || s === "conexao" || s === "configuracoes" || s === "respostas" || s === "funis") return s;
    return "assinantes";
  })();
  const [section, setSection] = useState<Section>(initialSection);
  const [tab, setTab] = useState<AssinantesTab>("kanban");
  const [shop, setShop] = useState<{ id: string; name: string } | null>(null);
  const [brand, setBrand] = useState<Brand>({});
  const [billing, setBilling] = useState<BillingStatus | null>(null);


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
    api(token, "/api/public/extension/billing").then((r) => {
      if (r?.ok && r.billing) setBilling(r.billing as BillingStatus);
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

  const NAV_TOP: Array<{ key: Section; label: string; icon: React.ReactNode }> = [
    { key: "assinantes", label: "Gestão de Assinaturas", icon: <IconUsers /> },
    { key: "funis", label: "Funis de Vendas", icon: <IconChart /> },
    { key: "respostas", label: "Respostas rápidas", icon: <IconChat /> },
    { key: "equipe", label: "Equipe", icon: <IconTrophy /> },

    { key: "configuracoes", label: "Configurações", icon: <IconGear /> },
    { key: "conexao", label: "Conexão", icon: <IconUsers /> },
  ];

  const navRowCls = (active: boolean) =>
    "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition " +
    (active
      ? "bg-yellow-400 text-neutral-900"
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
            return (
              <button key={n.key} onClick={() => setSection(n.key)} className={navRowCls(active)}>
                <span className="flex h-5 w-5 items-center justify-center">{n.icon}</span>
                <span className="flex-1 truncate">{n.label}</span>
                <IconChevron className={active ? "text-neutral-900" : "text-neutral-400 group-hover:text-neutral-700"} />
              </button>
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
                (section === n.key ? "bg-yellow-400 text-neutral-900" : "text-neutral-600")
              }
            >
              {n.label}
            </button>
          ))}
        </div>
      </div>




      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="mt-14 md:mt-0">
          <PlanBanner billing={billing} shopId={shop?.id} />
        </div>
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
                <KanbanView customers={customers} loading={loading} token={token} reload={reload} shopId={shop?.id ?? "default"} onGoSettings={() => setSection("configuracoes")} />
              )}
              {tab === "disparo" && (
                <DisparoView customers={customers} token={token} shopId={shop?.id ?? "default"} onDone={() => setTab("campanhas")} onNeedConnection={() => setSection("conexao")} />
              )}

              {tab === "campanhas" && <CampaignsView token={token} />}
            </main>
          </>
        )}

        {section === "funis" && token && (
          <main className="px-6 py-6 mt-14 md:mt-0">
            <FunnelsView api={(path: string, opts?: RequestInit) => api(token, path, opts)} />
          </main>
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
    const r = await sendWaAction({
      phone,
      name: customer.name,
      openOnly,
      text: openOnly ? undefined : text.trim() || undefined,
      actions: openOnly ? undefined : qr?.actions,
    });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Falha ao falar com a extensão"); return; }
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
                  className="whitespace-nowrap rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-yellow-400 disabled:opacity-50"
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
            className="flex-1 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-yellow-400 hover:bg-neutral-800 disabled:opacity-50"
          >
            {busy ? "Enviando..." : "Enviar agora"}
          </button>
        </div>
        <p className="text-[11px] text-neutral-500">
          O envio usa a sessão do WhatsApp Web já aberta — mantenha a aba do WhatsApp aberta.
        </p>
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
  const [goal, setGoal] = useState(0);

  useEffect(() => {
    setPlans(readPlans(shopId));
    setGoal(readGoal(shopId));
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

  const totalSubs = effective.filter((c) => c.status === "active" || c.status === "due_soon").length;
  const missing = Math.max(0, goal - totalSubs);
  const pct = goal > 0 ? Math.min(100, Math.round((totalSubs / goal) * 100)) : 0;
  const mrr = effective
    .filter((c) => c.status === "active" || c.status === "due_soon")
    .reduce((sum, c) => sum + priceOf(plans, planFromTags(c.tags)), 0);
  const plansMissingPrice = plans.filter((p) => p.priceCents <= 0).length;

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
      {/* Card de meta — gamificação */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
              Assinantes ativos
            </p>
            <p className="text-3xl font-semibold text-neutral-900">{totalSubs}</p>
            <p className="mt-1 text-xs text-neutral-500">
              Receita recorrente estimada: <strong className="text-neutral-800">{formatBRL(mrr)}</strong>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
              Meta do mês
            </p>
            <p className="text-3xl font-semibold text-neutral-900">{goal || "—"}</p>
            <p className="mt-1 text-xs text-neutral-500">
              {goal === 0
                ? "Defina a meta em Configurações"
                : missing === 0
                  ? "Meta batida 🎉"
                  : `Faltam ${missing} assinante(s)`}
            </p>
          </div>
        </div>
        <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-neutral-100">
          <div
            className="h-full rounded-full bg-yellow-400 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1 text-right text-[11px] font-medium text-neutral-500">{pct}% da meta</p>
        {plansMissingPrice > 0 && (
          <button
            onClick={onGoSettings}
            className="mt-3 text-xs font-medium text-neutral-900 underline underline-offset-2"
          >
            {plansMissingPrice} plano(s) sem valor cadastrado — definir agora
          </button>
        )}
      </div>

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
            <div className="space-y-2 p-3 min-h-40">
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
              className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-yellow-400 hover:bg-neutral-800 disabled:opacity-50"
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
          className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-yellow-400 hover:bg-neutral-800 disabled:opacity-50"
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
            Antes de importar, escolha em <strong>Configurações</strong> qual sistema de
            assinatura a barbearia usa (App Barber, Cash Barber, Frizzar ou outro). Assim o
            CRM sabe como ler a planilha e distribuir os assinantes nas colunas certas.
          </p>
          <button
            onClick={onGoSettings}
            className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-yellow-400 hover:bg-neutral-800"
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
          <div>{meta?.hint}</div>
          {system === "appbarber" && (
            <div className="mt-2 text-[11px] text-neutral-600">
              O CRM lê as colunas <code>Nome</code>, <code>Celular</code>, <code>Status</code> e{" "}
              <code>Plano</code> e distribui sozinho: <strong>Em Dia → Ativos</strong>,{" "}
              <strong>A vencer → A vencer</strong>,{" "}
              <strong>Inadimplente / Atrasado / Vencido → Inadimplentes</strong>,{" "}
              <strong>Cancelado / Inativo → Cancelados</strong>.
            </div>
          )}
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

        <p className="text-xs text-neutral-500">
          Ao importar, a planilha anterior é substituída. Contatos adicionados manualmente são preservados.
        </p>

        {err && <p className="text-sm text-red-500">{err}</p>}
        {result && <p className="whitespace-pre-line text-sm text-emerald-600">{result}</p>}
        <button
          disabled={busy || !file}
          className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-yellow-400 hover:bg-neutral-800 disabled:opacity-50"
        >
          {busy ? "Importando..." : "Importar e organizar"}
        </button>
      </form>
    </Modal>
  );
}



function DisparoView({
  customers,
  token,
  shopId,
  onDone,
  onNeedConnection,
}: {
  customers: Customer[];
  token: string;
  shopId: string;
  onDone: () => void;
  onNeedConnection: () => void;
}) {
  const cols = useMemo(() => visibleColumns(shopId), [shopId]);

  const [name, setName] = useState("");
  const [variants, setVariants] = useState<string[]>([""]);
  const [segment, setSegment] = useState<string>("overdue");
  const [paceMin, setPaceMin] = useState(20);
  const [paceMax, setPaceMax] = useState(60);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [quickReplyId, setQuickReplyId] = useState("");

  useEffect(() => {
    api(token, "/api/public/extension/quick-replies").then((r) => {
      if (r?.ok) setReplies((r.quick_replies as QuickReply[]) || []);
    });
  }, [token]);

  /** Usa os textos da resposta rápida como variações da campanha. */
  function applyQuickReply(id: string) {
    setQuickReplyId(id);
    const qr = replies.find((q) => q.id === id);
    if (!qr) return;
    const texts = qr.actions
      .filter((a) => a.type === "text" && a.text?.trim())
      .map((a) => (a.text as string).trim());
    if (texts.length) setVariants(texts.slice(0, 3));
    if (!name.trim()) setName(qr.title);
  }

  const selectedReply = replies.find((q) => q.id === quickReplyId);
  const droppedMedia = selectedReply
    ? selectedReply.actions.filter((a) => a.type !== "text").length
    : 0;

  // Contatos sem telefone real (placeholder de planilha) nunca entram na fila,
  // então o alvo mostrado precisa refletir só quem é enviável.
  const sendable = customers.filter((c) => isRealPhone(c.phone));
  const countIn = (key: string) =>
    key === "all" ? sendable.length : sendable.filter((c) => c.status === key).length;
  const total = countIn(segment);
  const semTelefone = (segment === "all"
    ? customers
    : customers.filter((c) => c.status === segment)
  ).filter((c) => !isRealPhone(c.phone)).length;

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
    if (!acceptedTerms) {
      setErr("Você precisa aceitar o termo de uso para enviar a campanha.");
      return;
    }
    if (total === 0) {
      setErr("Nenhum contato com telefone válido nesse público. Escolha outro público ou cadastre os telefones.");
      return;
    }

    setBusy(true);
    setErr(null);
    const st = await api(token, "/api/public/extension/whatsapp/status?sync=1");
    if (!st?.ok || st?.connection?.status !== "connected") {
      setBusy(false);
      setErr("WhatsApp não está conectado. Redirecionando pra aba Conexão…");
      setTimeout(() => onNeedConnection(), 800);
      return;
    }
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
    nudgeExtensionPoll();
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
          {cols.map((c) => <option key={c.key} value={c.key}>{c.label} ({countIn(c.key)})</option>)}
          <option value="all">Todos ({countIn("all")})</option>
        </select>
        <p className="mt-1 text-xs text-neutral-500">
          Vai disparar para <strong className="text-neutral-900">{total}</strong> contato(s).
          {semTelefone > 0 && ` ${semTelefone} contato(s) ficam de fora por não ter telefone cadastrado.`}
        </p>
      </Field>

      {replies.length > 0 && (
        <Field label="Resposta rápida (opcional)">
          <select value={quickReplyId} onChange={(e) => applyQuickReply(e.target.value)} className={inputCls}>
            <option value="">— escrever mensagem manualmente —</option>
            {replies.map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}
          </select>
          <p className="mt-1 text-xs text-neutral-500">
            Os textos da resposta rápida viram as variações abaixo (você pode editar).
            {droppedMedia > 0 && " Mídias não são enviadas no disparo em massa — só texto."}
          </p>
        </Field>
      )}


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

      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
        <p className="text-sm font-semibold text-neutral-900">Termo de uso</p>
        <p className="mt-2 text-sm leading-relaxed text-neutral-700">
          A pratica de envios em massa ou spam podem ocasionar o banimento do seu número por parte do WhatsApp. Envie mensagens apenas para pessoas que gostariam de receber sua mensagem.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-neutral-900">
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            className="h-4 w-4 rounded border-neutral-400"
          />
          Eu entendo e aceito os termos de uso.
        </label>
      </div>

      {err && <p className="text-sm text-red-500">{err}</p>}
      <button
        disabled={busy || !acceptedTerms}
        className="w-full rounded-lg bg-neutral-900 px-4 py-3 text-sm font-semibold text-yellow-400 hover:bg-neutral-800 disabled:opacity-50"
      >
        {busy ? "Criando..." : "Enviar Campanha"}
      </button>

    </form>
  );
}

// Cache module-scoped: sobrevive à troca de aba, evita "Carregando..." piscando.
let campaignsCache: Campaign[] | null = null;

function CampaignsView({ token }: { token: string }) {
  const { confirm, dialog } = useConfirm();
  const [campaigns, setCampaigns] = useState<Campaign[]>(campaignsCache ?? []);
  const [loaded, setLoaded] = useState<boolean>(campaignsCache !== null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function reload() {
    const r = await api(token, "/api/public/extension/campaigns");
    if (r?.ok) {
      const list: Campaign[] = r.campaigns || [];
      campaignsCache = list;
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
  if (loaded && !campaigns.length) {
    return <p className="text-neutral-400">Nenhuma campanha criada ainda.</p>;
  }

  return (
    <div className="space-y-3">
      {dialog}
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

function SettingsView({
  brand,
  fallbackName,
  onSave,
  shopId,
}: {
  brand: Brand;
  fallbackName: string;
  onSave: (b: Brand) => void;
  shopId: string;
}) {
  const [name, setName] = useState(brand.name || fallbackName || "");
  const [logo, setLogo] = useState(brand.logo || "");
  const [saved, setSaved] = useState(false);
  const [system, setSystem] = useState<SubscriptionSystemId | "">(() => readSystem(shopId) ?? "");
  const [systemSaved, setSystemSaved] = useState(false);
  const [plans, setPlans] = useState<Plan[]>(() => readPlans(shopId));
  const [plansSaved, setPlansSaved] = useState(false);
  const [newPlan, setNewPlan] = useState("");
  const [goal, setGoal] = useState<number>(() => readGoal(shopId));
  const fileRef = useRef<HTMLInputElement | null>(null);

  function saveSystem(id: SubscriptionSystemId) {
    setSystem(id);
    writeSystem(shopId, id);
    setSystemSaved(true);
    setTimeout(() => setSystemSaved(false), 1800);
  }

  function persistPlans(next: Plan[]) {
    setPlans(next);
    writePlans(shopId, next);
    setPlansSaved(true);
    setTimeout(() => setPlansSaved(false), 1500);
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

      <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-neutral-900">Sistema de assinatura</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {SUBSCRIPTION_SYSTEMS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => saveSystem(s.id)}
              className={
                "rounded-xl border px-3 py-3 text-left text-sm transition " +
                (system === s.id
                  ? "border-neutral-900 bg-neutral-900 text-yellow-400"
                  : "border-neutral-200 bg-white text-neutral-800 hover:border-neutral-400")
              }
            >
              <span className="block font-semibold">{s.label}</span>
            </button>
          ))}
        </div>
        {systemSaved && <span className="text-xs font-medium text-emerald-600">Salvo ✔</span>}
      </div>

      <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Planos e valores</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Cadastre o valor de cada plano. O CRM usa o plano que vem na planilha para
            somar o faturamento de cada coluna do Kanban.
          </p>
        </div>

        <div className="space-y-2">
          {plans.length === 0 && (
            <p className="text-xs text-neutral-400">
              Nenhum plano ainda. Importe a planilha (os planos são detectados sozinhos) ou cadastre abaixo.
            </p>
          )}
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
              <div className="flex items-center gap-1">
                <span className="text-xs text-neutral-500">R$</span>
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
              </div>
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
        </div>

        <div className="flex items-center gap-2">
          <input
            value={newPlan}
            onChange={(e) => setNewPlan(e.target.value)}
            placeholder="Novo plano (ex.: Night Plan)"
            className={inputCls}
          />
          <button
            type="button"
            onClick={addPlan}
            className="shrink-0 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-yellow-400 hover:bg-neutral-800"
          >
            Adicionar
          </button>
        </div>
        {plansSaved && <span className="text-xs font-medium text-emerald-600">Salvo ✔</span>}
      </div>

      <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Meta do mês</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Quantos assinantes ativos você quer fechar o mês. Vira a barra de progresso no Kanban.
          </p>
        </div>
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
