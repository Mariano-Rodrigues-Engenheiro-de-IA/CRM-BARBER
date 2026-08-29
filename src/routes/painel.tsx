// Painel web do CRM — aberto em nova aba pela extensão.
//
// Auth: token da extensão passado via `?token=<raw>` na primeira abertura,
// persistido em localStorage. As chamadas à API pública `/api/public/extension/*`
// vão com Authorization: Bearer <token>. Same-origin → sem preocupação com CORS.

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TeamView } from "@/components/team-view";
import { ConnectionView } from "@/components/connection-view";
import { QuickRepliesView } from "@/components/quick-replies-view";
import { TemplatesView } from "@/components/templates-view";
import { FunnelsView } from "@/components/funnels-view";
import { DispatchCenter } from "@/components/dispatch-view";
import { sendWaAction, isRealPhone, openWhatsappChat, applyFunnelActions } from "@/lib/wa-actions";

import { sendableActions, type QuickReply } from "@/lib/quick-replies";
import { FREE_LIMITS, PREMIUM_PRICE_LABEL, type BillingStatus } from "@/lib/billing";

import { useConfirm } from "@/components/confirm-dialog";
import { AgendaView } from "@/components/agenda-view";
import { AulasView } from "@/components/aulas-view";
import { AgenteIaView } from "@/components/agente-ia-view";
import { ServicesTab, ProfessionalsTab, ProductsTab } from "@/components/professionals-services-dialog";
import { GeneralSettingsTab } from "@/components/agenda-settings-dialog";
import { AccountTab } from "@/components/account-tab";
import { CustomersTab } from "@/components/customers-tab";
import { toast } from "sonner";


import {
  SUBSCRIPTION_SYSTEMS,
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
      { title: "Painel | CRM Zaylo" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Painel de gestão de assinantes da barbearia." },
      { property: "og:title", content: "Painel | CRM Zaylo" },
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
  is_subscriber?: boolean;
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

type CampaignJobRow = {
  id: string;
  name: string | null;
  phone: string;
  status: string;
  error: string | null;
};


type Col = { key: string; label: string };

const COLUMNS: Col[] = [
  { key: "active", label: "Ativos" },
  { key: "due_soon", label: "A vencer" },
  { key: "overdue", label: "Inadimplentes" },
  { key: "reactivate", label: "Reativar" },
  { key: "canceled", label: "Cancelados" },
];

// Kanbans da barbearia: NÃO existem colunas padrão. Elas nascem da planilha
// importada (uma coluna por status encontrado) ou da criação manual.
function colsKey(shopId: string) { return `crm_cols_${shopId || "default"}`; }

/** Colunas visíveis: só as criadas pelo usuário/importação. */
function visibleColumns(shopId: string): Col[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(colsKey(shopId));
    const parsed = raw ? (JSON.parse(raw) as Col[]) : null;
    if (Array.isArray(parsed)) return parsed.filter((c) => c && c.key && c.label);
  } catch { /* ignora json inválido */ }
  return [];
}

function writeColumns(shopId: string, cols: Col[]) {
  localStorage.setItem(colsKey(shopId), JSON.stringify(cols));
}

/** Rótulo amigável para um status vindo da planilha. */
function statusLabel(key: string) {
  const known = COLUMNS.find((c) => c.key === key);
  if (known) return known.label;
  return key.replace(/^custom_/, "").replace(/_/g, " ").replace(/^./, (m) => m.toUpperCase());
}

/**
 * Após importar a planilha, a estrutura de kanbans espelha a estrutura dela:
 * um kanban por status presente, na ordem em que aparecem.
 */
function syncColumnsFromSheet(shopId: string, statusKeys: string[]) {
  const cols = statusKeys.map((key) => ({ key, label: statusLabel(key) }));
  if (cols.length) writeColumns(shopId, cols);
  return cols;
}



/** Cache entre navegações: voltar pra Assinantes não pisca "Carregando...". */
let customersCache: Customer[] | null = null;

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

type Section = "agenda" | "agente-ia" | "treinamento" | "configuracoes" | "assinantes" | "funis" | "disparo" | "respostas" | "equipe" | "conexao" | "templates";
/** Sub-abas da sanfona de Assinaturas. */
type AssinTab = "visao" | "assinantes";
/** Sub-abas da sanfona de Configurações. */
type ConfigTab = "servicos" | "produtos" | "profissionais" | "clientes" | "gerais" | "conta";

/** Selo de assinante ativo — assinatura/fidelidade, sem usar ícone de pessoas. */
function IconBadgeCheck() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.3 11 14.8l4.5-5" />
    </svg>
  );
}
/** Barras ascendentes — ranking de vendas (não amarrado a "barbeiro"/troféu). */
function IconRankingBars() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="13" width="4.5" height="7" rx="1" />
      <rect x="9.75" y="9" width="4.5" height="11" rx="1" />
      <rect x="16" y="4.5" width="4.5" height="15.5" rx="1" />
    </svg>
  );
}
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
/** Raio — Respostas rápidas. Mesmo ícone usado no rail do WhatsApp e dentro
 * de cada conversa, pra ficar padronizado em todo o sistema. */
function IconChat() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
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
/** Cabeçalho padrão das telas — ícone num quadrado colorido + título com peso
 * de verdade (não mais caps-lock) + linha de apoio opcional. Piloto em
 * Agenda / Assinaturas / Ranking de vendas antes de estender pro resto. */
function SectionHeader({
  title,
  subtitle,
  right,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/95 backdrop-blur mt-14 md:mt-0">
      <div className="flex items-center gap-3 px-5 py-3">
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <h1 className="truncate text-[15px] font-semibold text-neutral-900">{title}</h1>
          {subtitle && (
            <>
              <span className="shrink-0 text-neutral-300">›</span>
              <span className="truncate text-[15px] text-neutral-500">{subtitle}</span>
            </>
          )}
        </div>
        {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
      </div>
    </header>
  );
}
/** Aviãozinho de disparo — o clássico ícone de "enviar em massa". */
function IconSend() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
/** Plug — seção de Conexão (não repetir o ícone de Assinaturas). */
/** Link/corrente — plugue trocado por um símbolo mais "conexão/integração". */
function IconPlug() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 14.5 14.5 9.5" />
      <path d="M11 5.2 12 4.2a3.6 3.6 0 1 1 5.1 5.1l-1 1" />
      <path d="M13 18.8 12 19.8a3.6 3.6 0 1 1-5.1-5.1l1-1" />
    </svg>
  );
}

function IconGraduationCap() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 9 12 3 1 9l11 6 11-6Z" />
      <path d="M5 11.5v5c0 1.8 3.1 3.5 7 3.5s7-1.7 7-3.5v-5" />
      <path d="M23 9v7" />
    </svg>
  );
}

function IconRobot() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="8.5" width="18" height="12.5" rx="2.5" />
      <path d="M12 8.5V4" /><circle cx="12" cy="2.5" r="1.6" />
      <circle cx="8.5" cy="14.5" r="1.2" /><circle cx="15.5" cy="14.5" r="1.2" />
      <path d="M1 12.5v4M23 12.5v4" />
    </svg>
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
  const [customers, setCustomers] = useState<Customer[]>(() => customersCache ?? []);
  const [loading, setLoading] = useState(false);

  const initialSection: Section = (() => {
    if (typeof window === "undefined") return "assinantes";
    const s = new URLSearchParams(window.location.search).get("section");
    if (s === "agenda" || s === "agente-ia" || s === "treinamento" || s === "configuracoes" || s === "equipe" || s === "conexao" || s === "respostas" || s === "funis" || s === "disparo" || s === "templates") return s;
    return "assinantes";
  })();
  const [section, setSection] = useState<Section>(initialSection);
  const [assinTab, setAssinTab] = useState<AssinTab>("assinantes");
  const [configTab, setConfigTab] = useState<ConfigTab>("servicos");
  // Sanfona do menu: guarda QUAL seção está aberta — antes era um booleano
  // único, o que abria as sub-abas de Assinaturas e Configurações juntas.
  const [openMenu, setOpenMenu] = useState<Section | null>(null);
  // Menu lateral colapsável — recolhido por padrão (dá mais espaço pro
  // sistema), a menos que o usuário já tenha expandido explicitamente
  // numa sessão anterior (nesse caso lembra a preferência).
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => typeof window === "undefined" || localStorage.getItem("zaylo_sidebar_v2") !== "0",
  );
  useEffect(() => {
    localStorage.setItem("zaylo_sidebar_v2", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  const [disparoTab, setDisparoTab] = useState<"novo" | "campanhas">("novo");
  // Host do cabeçalho dos funis: o seletor de funil + "novo funil" moram na
  // barra superior, mas o estado deles vive dentro do FunnelsView (portal).
  const [funisHeaderEl, setFunisHeaderEl] = useState<HTMLDivElement | null>(null);
  // Host do cabeçalho de Assinantes: os botões de ação moram na barra do topo,
  // ao lado do título, liberando altura pros kanbans.
  const [assinHeaderEl, setAssinHeaderEl] = useState<HTMLDivElement | null>(null);
  const [equipeHeaderEl, setEquipeHeaderEl] = useState<HTMLDivElement | null>(null);
  const [shop, setShop] = useState<{ id: string; name: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isMetaProvider, setIsMetaProvider] = useState(false);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
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
    // Com cache quente nunca mostramos spinner: os dados antigos ficam na tela
    // enquanto a atualização chega por baixo.
    if (!silent && customersCache === null) setLoading(true);
    const r = await api(token, "/api/public/extension/customers");
    if (r?.ok) {
      const list = (r.customers || []) as Customer[];
      customersCache = list;
      setCustomers(list);
    }
    setLoading(false);
  }

  // Assinantes = contatos marcados como assinantes. Clientes cadastrados em
  // Configurações → Clientes não entram nos kanbans de assinatura.
  const subscribers = useMemo(() => customers.filter((c) => c.is_subscriber), [customers]);

  useEffect(() => {
    if (!token) return;
    reload();

    api(token, "/api/public/extension/meta").then((r) => {
      if (r?.ok && r.barbershop) {
        setShop(r.barbershop);
        setBrand(readBrand(r.barbershop.id));
      }
      if (r?.ok) setIsAdmin(Boolean(r.is_admin));
    });
    api(token, "/api/public/extension/whatsapp/status").then((r) => {
      if (r?.ok && r.connection) setIsMetaProvider((r.connection as { provider?: string }).provider === "meta");
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
            Abra este painel pela extensão do CRM no WhatsApp Web. O botão manda
            você pra cá já autenticado.
          </p>
        </div>
      </div>
    );
  }

  const shopName = brand.name || shop?.name || "Sua barbearia";

  /** Abre o checkout do Premium em nova aba, já identificando a barbearia. */
  function openCheckout() {
    const params = new URLSearchParams({ plano: "premium" });
    const raw = localStorage.getItem(TOKEN_KEY);
    if (raw && raw.startsWith("ext_")) params.set("token", raw);
    else if (shop?.id) params.set("shop", shop.id);
    window.open(`/assinar?${params.toString()}`, "_blank", "noopener");
  }


  function saveBrand(next: Brand) {
    if (!shop?.id) return;
    writeBrand(shop.id, next);
    setBrand(next);
  }

  const NAV_TOP: Array<{
    key: Section;
    label: string;
    icon: React.ReactNode;
    children?: Array<{ key: AssinTab | ConfigTab; label: string }>;
  }> = [
    { key: "agenda", label: "Agenda", icon: <IconCalendar /> },
    { key: "funis", label: "Funis de Vendas", icon: <IconChart /> },
    { key: "disparo", label: "Disparo", icon: <IconSend /> },
    { key: "respostas", label: "Respostas rápidas", icon: <IconChat /> },
    {
      key: "assinantes",
      label: "Assinaturas",
      icon: <IconBadgeCheck />,
      children: [
        { key: "visao", label: "Visão geral" },
        { key: "assinantes", label: "Assinantes" },
      ],
    },
    { key: "equipe", label: "Ranking de vendas", icon: <IconRankingBars /> },
    ...(isAdmin && isMetaProvider ? [{ key: "templates" as Section, label: "Modelos", icon: <IconNote /> }] : []),

    { key: "conexao", label: "Conexão", icon: <IconPlug /> },
    { key: "agente-ia", label: "Agente de IA", icon: <IconRobot /> },
    {
      key: "configuracoes",
      label: "Configurações",
      icon: <IconGear />,
      children: [
        { key: "servicos", label: "Serviços" },
        { key: "produtos", label: "Produtos" },
        { key: "profissionais", label: "Profissionais" },
        { key: "clientes", label: "Clientes" },
        { key: "gerais", label: "Gerais" },
        { key: "conta", label: "Minha conta" },
      ],
    },
    { key: "treinamento", label: "Treinamentos", icon: <IconGraduationCap /> },
  ];

  const navRowCls = (active: boolean) =>
    "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition " +
    (active
      ? "bg-brand text-white"
      : "text-sidebar-foreground/70 hover:bg-brand/25 hover:text-white");

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar fixa — h-full + overflow-y-auto próprio, pra nunca rolar
         junto com o conteúdo principal (antes era só min-h-screen, sem
         nenhum contêiner de rolagem independente, então a página inteira
         rolava e a barra lateral "subia" junto, dando sensação de site
         quebrado). */}
      <aside className={"hidden md:flex h-full shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200 " + (sidebarCollapsed ? "w-[68px]" : "w-64")}>
        <div className={"flex pt-5 pb-4 " + (sidebarCollapsed ? "flex-col items-center gap-2 px-2" : "items-center justify-between pl-6 pr-3")}>
          <div className={"relative flex h-9 shrink-0 items-center transition-[width] duration-200 " + (sidebarCollapsed ? "w-9 justify-center" : "w-36 justify-start")}>
            {/* Ambas as imagens ficam sempre montadas (já pré-carregadas) e alternam
                via opacidade, em sincronia com a transição de largura da sidebar,
                evitando o "salto" que acontecia ao trocar de <img> condicionalmente. */}
            <img
              src="/brand/zaylo-logo.png"
              alt="CRM Zaylo"
              className={
                "absolute left-0 h-8 w-auto object-contain object-left transition-opacity duration-200 " +
                (sidebarCollapsed ? "opacity-0" : "opacity-100")
              }
            />
            <img
              src="/brand/zaylo-icon.png"
              alt="CRM Zaylo"
              className={
                "absolute h-8 w-auto object-contain transition-opacity duration-200 " +
                (sidebarCollapsed ? "opacity-100" : "opacity-0")
              }
            />
          </div>
          <button
            onClick={() => setSidebarCollapsed((v) => !v)}
            title={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground/50 transition hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              className={"h-4 w-4 transition-transform " + (sidebarCollapsed ? "rotate-180" : "")}
            >
              <path d="M12.5 4l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>


        <div className="mx-3 mb-2 h-px bg-sidebar-border" />


        <nav className={"flex-1 space-y-1 " + (sidebarCollapsed ? "px-2" : "px-3")}>
          {NAV_TOP.map((n) => {
            const active = section === n.key;
            const open = Boolean(n.children) && openMenu === n.key && !sidebarCollapsed;
            return (
              <div key={n.key} className="group relative">
                <button
                  onClick={() => {
                    // Menu recolhido: clicar num ícone expande o menu, pra o
                    // usuário enxergar as sub-abas da seção.
                    const wasCollapsed = sidebarCollapsed;
                    if (wasCollapsed) setSidebarCollapsed(false);
                    if (n.children) {
                      // Sanfona individual: abre só a seção clicada.
                      setOpenMenu((cur) => (cur === n.key && !wasCollapsed ? null : n.key));
                      if (!active) setSection(n.key);
                      return;
                    }
                    setOpenMenu(null);
                    setSection(n.key);
                  }}
                  className={navRowCls(active) + (sidebarCollapsed ? " justify-center px-0" : "")}
                >
                  <span className="flex h-5 w-5 items-center justify-center">{n.icon}</span>
                  {!sidebarCollapsed && (
                    <>
                      <span className="flex-1 truncate">{n.label}</span>
                      {/* Seta só aparece em itens que realmente têm sub-abas — os
                          demais ficam sem seta, a pedido do Mariano. */}
                      {n.children && (
                        <IconChevron
                          className={
                            (open ? "rotate-90 " : "") +
                            (active ? "text-white/70" : "text-sidebar-foreground/40 group-hover:text-sidebar-foreground/80")
                          }
                        />
                      )}
                    </>
                  )}
                </button>
                {sidebarCollapsed && (
                  <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-brand px-2.5 py-1.5 text-xs font-semibold text-white opacity-0 shadow-lg transition-opacity duration-75 group-hover:opacity-100">
                    {n.label}
                  </span>
                )}
                {open && n.children && (
                  <div className="mt-1 space-y-0.5 border-l border-sidebar-border pl-3 ml-4">
                    {n.children.map((sub) => {
                      const isSubActive = n.key === "assinantes" ? assinTab === sub.key : n.key === "configuracoes" ? configTab === sub.key : false;
                      return (
                        <button
                          key={sub.key}
                          onClick={() => {
                            setSection(n.key);
                            if (n.key === "assinantes") setAssinTab(sub.key as AssinTab);
                            else if (n.key === "configuracoes") setConfigTab(sub.key as ConfigTab);
                          }}
                          className={
                            "block w-full rounded-lg px-3 py-1.5 text-left text-[13px] transition " +
                            (active && isSubActive
                              ? "bg-sidebar-accent font-semibold text-sidebar-foreground"
                              : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground")
                          }
                        >
                          {sub.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );

          })}
        </nav>

        {billing && !billing.premium && (
          <div className="m-3 rounded-2xl border border-yellow-400/60 bg-yellow-50 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-yellow-700">
              Plano grátis
            </p>
            <p className="mt-1 text-xs text-neutral-700">
              {billing.usage.customers}/{FREE_LIMITS.customers} contatos · até{" "}
              {FREE_LIMITS.dispatchBatch} por disparo · equipe bloqueada.
            </p>
            <button
              onClick={openCheckout}
              className="mt-3 w-full rounded-lg bg-brand px-3 py-2 text-xs font-bold text-yellow-400 transition hover:bg-brand-strong"
            >
              Assinar Premium · {PREMIUM_PRICE_LABEL}
            </button>
          </div>
        )}




      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 z-30 flex items-center justify-between border-b border-sidebar-border bg-sidebar text-sidebar-foreground px-4 py-3">
        <img src="/brand/zaylo-logo.png" alt="CRM Zaylo" className="h-7 w-auto object-contain" />
        <div className="flex gap-1 rounded-lg bg-sidebar-accent/40 p-1">
          {NAV_TOP.map((n) => (
            <button
              key={n.key}
              onClick={() => setSection(n.key)}
              className={
                "rounded-md px-2.5 py-1 text-[11px] font-medium " +
                (section === n.key ? "bg-brand text-white" : "text-sidebar-foreground/70")
              }
            >
              {n.label}
            </button>
          ))}
        </div>
      </div>




      {/* Content */}
      <div className="flex-1 min-w-0 h-full overflow-y-auto">
        {section === "agenda" && token && (
          <>
            <SectionHeader icon={<IconCalendar />} title="Agenda" />
            <main className="px-4 py-4">
              <AgendaView api={(path: string, opts?: RequestInit) => api(token, path, opts)} />
            </main>
          </>
        )}

        {section === "agente-ia" && token && (
          <>
            <header className="sticky top-0 z-10 overflow-hidden bg-brand mt-14 md:mt-0">
              <div className="flex items-center py-2.5">
                <div className="flex w-max shrink-0 animate-ai-ticker items-center whitespace-nowrap">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="flex shrink-0 items-center">
                      {["Vendas", "Agendamentos", "Atendimento 24 horas", "Humanização", "Fidelização"].map((word) => (
                        <span key={word} className="flex items-center text-[13px] font-semibold uppercase tracking-widest text-white">
                          {word}
                          <span className="mx-4 h-1 w-1 rounded-full bg-white/50" />
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </header>
            <main className="relative px-4 py-6">
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage:
                    "radial-gradient(rgba(59,130,246,0.16) 1px, transparent 1px), linear-gradient(rgba(59,130,246,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.06) 1px, transparent 1px)",
                  backgroundSize: "24px 24px, 48px 48px, 48px 48px",
                }}
              />
              <div className="relative">
                <AgenteIaView api={(path: string, opts?: RequestInit) => api(token, path, opts)} />
              </div>
            </main>
          </>
        )}

        {section === "treinamento" && token && (
          <>
            <header className="sticky top-0 z-10 bg-brand mt-14 md:mt-0">
              <div className="flex items-center gap-2.5 px-5 py-3">
                <span className="text-white"><IconGraduationCap /></span>
                <h1 className="truncate text-[15px] font-medium leading-tight text-white">
                  Treinamentos
                </h1>
              </div>
            </header>
            <main className="px-4 py-6">
              <AulasView api={(path: string, opts?: RequestInit) => api(token, path, opts)} />
            </main>
          </>
        )}

        {section === "configuracoes" && token && (
          <>
            <SectionHeader
              icon={<IconGear />}
              title="Configurações"
              subtitle={
                (configTab === "servicos" && "Serviços") ||
                (configTab === "produtos" && "Produtos") ||
                (configTab === "profissionais" && "Profissionais") ||
                (configTab === "clientes" && "Clientes") ||
                (configTab === "gerais" && "Gerais") ||
                (configTab === "conta" && "Minha conta") ||
                undefined
              }
            />
            <main className="px-4 py-4">
              {configTab === "servicos" && <ServicesTab api={(path: string, opts?: RequestInit) => api(token, path, opts)} />}
              {configTab === "produtos" && <ProductsTab api={(path: string, opts?: RequestInit) => api(token, path, opts)} />}
              {configTab === "profissionais" && <ProfessionalsTab api={(path: string, opts?: RequestInit) => api(token, path, opts)} />}
              {configTab === "clientes" && <CustomersTab api={(path: string, opts?: RequestInit) => api(token, path, opts)} />}
              {configTab === "gerais" && <GeneralSettingsTab api={(path: string, opts?: RequestInit) => api(token, path, opts)} />}
              {configTab === "conta" && <AccountTab api={(path: string, opts?: RequestInit) => api(token, path, opts)} />}
            </main>
          </>
        )}

        {section === "assinantes" && (
          <>
            <SectionHeader
              title="Assinantes"
              subtitle={assinTab === "visao" ? "Visão geral" : undefined}
              right={<div ref={setAssinHeaderEl} className="flex shrink-0 items-center gap-2" />}
            />

            <main className="px-4 py-3">
              {assinTab === "visao" && (
                <OverviewView customers={subscribers} shopId={shop?.id ?? "default"} />
              )}
              {assinTab === "assinantes" && (
                <KanbanView
                  customers={subscribers}
                  loading={loading}
                  token={token}
                  reload={reload}
                  shopId={shop?.id ?? "default"}
                  headerHost={assinHeaderEl}
                  onGoSettings={() => setAssinTab("visao")}
                />
              )}
            </main>
          </>
        )}

        {section === "disparo" && token && (
          <>
            <SectionHeader
              icon={<IconSend />}
              title="Disparo"
              right={
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
              }
            />
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
          <>
            <SectionHeader icon={<IconChat />} title="Respostas rápidas" />
            <main className="px-4 py-4">
              <QuickRepliesView token={token} api={(path: string, opts?: RequestInit) => api(token, path, opts)} />
            </main>
          </>
        )}

        {section === "equipe" && token && (
          <>
            <SectionHeader
              icon={<IconRankingBars />}
              title="Ranking de vendas"
              right={billing?.premium !== false ? <div ref={setEquipeHeaderEl} className="flex shrink-0 items-center gap-2" /> : undefined}
            />
            <main className="px-4 py-4">
              {billing && !billing.premium ? (
                <div className="mx-auto max-w-lg rounded-xl border border-neutral-300 bg-white p-8 text-center">
                  <p className="text-xs font-semibold uppercase tracking-widest text-yellow-600">
                    Recurso Premium
                  </p>
                  <h2 className="mt-2 text-xl font-bold text-neutral-900">
                    Ranking de vendas
                  </h2>
                  <p className="mt-2 text-sm text-neutral-600">
                    Lançamento de vendas por profissional, ranking da equipe, ranking de clientes e
                    histórico de consumo fazem parte do plano pago.
                  </p>
                  <button
                    onClick={openCheckout}
                    className="mt-6 w-full rounded-xl bg-yellow-400 px-4 py-3 text-sm font-bold text-neutral-950 transition hover:bg-yellow-300"
                  >
                    Assinar Premium por {PREMIUM_PRICE_LABEL}
                  </button>
                </div>
              ) : (
                <TeamView
                  shopId={shop?.id ?? "default"}
                  headerHost={equipeHeaderEl}
                  api={(path: string, opts?: RequestInit) => api(token, path, opts)}
                  customers={customers}
                  onGoToSettings={(tab) => {
                    setSection("configuracoes");
                    setConfigTab(tab);
                  }}
                />
              )}
            </main>
          </>
        )}


        {section === "conexao" && token && (
          <>
            <SectionHeader icon={<IconPlug />} title="Conexão" />
            <main className="max-w-3xl px-4 py-4">
              <ConnectionView api={(path: string, opts?: RequestInit) => api(token, path, opts)} />
            </main>
          </>
        )}

        {section === "templates" && token && isAdmin && isMetaProvider && (
          <>
            <main className="max-w-6xl px-4 py-4">
              <TemplatesView api={(path: string, opts?: RequestInit) => api(token, path, opts)} />
            </main>
          </>
        )}

      </div>
    </div>
  );
}


type DrawerTab = "notes" | "schedule";

function IconWhatsapp() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M12 2C6.5 2 2 6.4 2 11.8c0 1.9.5 3.7 1.5 5.3L2 22l5.1-1.4c1.5.8 3.2 1.3 4.9 1.3 5.5 0 10-4.4 10-9.9C22 6.4 17.5 2 12 2Zm5.6 14c-.2.7-1.4 1.3-2 1.4-.5.1-1.2.1-1.9-.1-.4-.1-1-.3-1.7-.6-3-1.3-4.9-4.3-5.1-4.5-.1-.2-1.2-1.6-1.2-3.1s.8-2.2 1.1-2.5c.3-.3.6-.4.8-.4h.6c.2 0 .5 0 .7.6l1 2.3c.1.2.1.4 0 .6l-.5.6-.4.5c-.1.2-.3.4-.1.7.2.3.9 1.4 1.9 2.3 1.3 1.2 2.4 1.5 2.7 1.7.3.2.5.1.7-.1l.9-1c.2-.3.4-.2.7-.1l2.1 1c.3.1.6.2.6.4.1.2.1.9-.1 1.6Z" />
    </svg>
  );
}
/** Layout de template — retângulo com cabeçalho + linhas de conteúdo. */
function IconNote() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4.5" y="3.5" width="15" height="17" rx="1.6" />
      <path d="M4.5 8.5h15" />
      <path d="M8 12.3h8M8 15.5h5.5" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="13" r="8" />
      <path d="M11 9.2V13l2.6 1.6" />
      <path d="M8.2 2.6h5.6M18.5 5l1.6-1.6" />
    </svg>
  );
}

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
      onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
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
          <select value={selected} onChange={(e) => setSelected(e.target.value)} className={inputCls}>
            <option value="">Nenhuma (mensagem manual)</option>
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

function KanbanView({

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
      description: contactCount > 0
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
              if (e.key === "Enter") { addColumn(newCol); setNewCol(null); }
              if (e.key === "Escape") setNewCol(null);
            }}
            placeholder="Nome do kanban"
            className="w-44 rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-900 outline-none focus:border-brand"
          />
          <button
            onClick={() => { addColumn(newCol); setNewCol(null); }}
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white hover:bg-brand-strong"
          >
            Criar
          </button>
          <button onClick={() => setNewCol(null)} className="text-xs text-neutral-500 hover:text-neutral-900">
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
            <p className="text-base font-semibold text-neutral-900">Comece importando sua planilha</p>
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
              (overCol === col.key ? "border-neutral-400 ring-2 ring-neutral-300/60" : "border-neutral-200")
            }
          >
            <div className="border-b border-neutral-200 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="truncate text-[11px] font-semibold uppercase tracking-wider text-neutral-700">{col.label}</h3>
                <button
                  onClick={() => void removeColumn(col)}
                  title="Excluir kanban"
                  className="shrink-0 rounded p-0.5 text-neutral-300 transition hover:text-red-600"
                >
                  ✕
                </button>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[11px] text-neutral-500">{byStatus[col.key]?.length ?? 0} contato(s)</p>
                <p className="text-xs font-semibold text-neutral-900">{formatBRL(colTotal(col.key))}</p>
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
                    onDragEnd={() => { setDragId(null); setOverCol(null); }}
                    onClick={() => setDetail(c)}
                    className={
                      "select-none cursor-grab rounded-lg border border-neutral-300 bg-neutral-50 p-2.5 text-[13px] transition hover:-translate-y-0.5 hover:border-neutral-400 hover:shadow-md active:cursor-grabbing " +
                      (dragId === c.id ? "opacity-50" : "")
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-neutral-900">{c.name || phoneLabel(c.phone)}</div>
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
                            onClick={() => { setDetailTab("notes"); setDetail(c); }}
                            colorClass="text-sky-600 hover:bg-sky-50"
                          >
                            <IconNote />
                          </CardAction>
                          <CardAction
                            title="Mensagem agendada"
                            onClick={() => { setDetailTab("schedule"); setDetail(c); }}
                            colorClass="text-orange-600 hover:bg-orange-50"
                          >
                            <IconClock />
                          </CardAction>
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); remove(c.id); }}
                        className="rounded-md p-1 text-neutral-400 transition hover:bg-red-50 hover:text-red-600"
                        title="Remover"
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
        name: `Mensagem: ${customer.name}`,
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


function AddModal({ token, cols, onClose }: { token: string; cols: Array<{ key: string; label: string }>; onClose: () => void }) {
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
      body: JSON.stringify({ name: name.trim(), phone: phone.trim(), status, tags: [], is_subscriber: true }),
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
            (meta?.label ?? "sistema") + " e tem colunas de nome e telefone.",
        );
      }
      const r = await api(token, "/api/public/extension/customers/import", {
        method: "POST",
        body: JSON.stringify({ customers: report.rows, mode: "replace_spreadsheet", is_subscriber: true }),
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

      const dist = syncedCols
        .map((c) => `${c.label}: ${report.byStatus[c.key]}`)
        .join(" · ");

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
const campaignsCache: Record<string, Campaign[] | undefined> = {};


function CampaignsView({ token, scope }: { token: string; scope?: "assinaturas" | "funil" }) {
  const { confirm, dialog } = useConfirm();
  const cacheKey = scope ?? "todos";
  const [campaigns, setCampaigns] = useState<Campaign[]>(campaignsCache[cacheKey] ?? []);
  const [loaded, setLoaded] = useState<boolean>(campaignsCache[cacheKey] !== undefined);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Detalhe expandido (lista de contatos individuais) de UMA campanha por
  // vez — evita fazer polling pesado de todos os jobs de todas as
  // campanhas o tempo todo, só busca quando o usuário realmente abre.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedJobs, setExpandedJobs] = useState<CampaignJobRow[]>([]);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const jobsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadJobs(campaignId: string) {
    const r = await api(token, `/api/public/extension/campaigns/${campaignId}`);
    if (r?.ok) setExpandedJobs(r.jobs || []);
  }

  function toggleExpanded(c: Campaign) {
    if (expandedId === c.id) {
      setExpandedId(null);
      setExpandedJobs([]);
      if (jobsTimerRef.current) clearInterval(jobsTimerRef.current);
      return;
    }
    setExpandedId(c.id);
    setExpandedLoading(true);
    loadJobs(c.id).finally(() => setExpandedLoading(false));
  }

  useEffect(() => {
    if (jobsTimerRef.current) clearInterval(jobsTimerRef.current);
    if (!expandedId) return;
    const campaign = campaigns.find((c) => c.id === expandedId);
    // Só faz polling enquanto a campanha estiver realmente em andamento —
    // campanha parada/cancelada não muda mais, não precisa recarregar.
    if (campaign?.status !== "running") return;
    jobsTimerRef.current = setInterval(() => loadJobs(expandedId), 3000);
    return () => { if (jobsTimerRef.current) clearInterval(jobsTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedId, campaigns.find((c) => c.id === expandedId)?.status]);

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
        const isFinal = c.status === "canceled" || (total > 0 && c.stats.pending === 0);
        return (
          <div key={c.id} className="rounded-xl border border-neutral-300 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-neutral-900">{c.name}</h3>
                <p className="text-xs uppercase tracking-wide text-neutral-500">
                  {isFinal && c.status !== "canceled"
                    ? "Finalizada"
                    : c.status === "running" ? "Em andamento" : c.status === "paused" ? "Pausada" : c.status === "canceled" ? "Cancelada" : c.status}
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
                    onClick={() => cancelCamp(c)}
                    className="rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-600 hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                  >
                    Cancelar Envio
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

            {/* Contadores grandes — Total / Enviados / Erros, igual à
                referência que o Mariano mandou (extensão "Envio Rápido"). */}
            <div className="mt-5 grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-neutral-500">Total de contatos</p>
                <p className="mt-1 text-2xl font-bold text-neutral-900">{total}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-neutral-500">Enviados</p>
                <p className="mt-1 text-2xl font-bold text-emerald-600">{c.stats.sent}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-neutral-500">Erro ao enviar</p>
                <p className="mt-1 text-2xl font-bold text-red-600">{c.stats.failed}</p>
              </div>
            </div>

            {!isFinal && (
              <button
                onClick={() => toggleStatus(c)}
                className={
                  "mx-auto mt-4 block rounded-full px-6 py-2 text-sm font-semibold transition " +
                  (isRunning
                    ? "bg-emerald-500 text-white hover:bg-emerald-600"
                    : "bg-brand text-white hover:bg-brand-strong")
                }
              >
                {isRunning ? "⏸ Pausar Campanha" : "▶ Retomar Campanha"}
              </button>
            )}

            <div className="mt-4">
              <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                <div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
                <button
                  onClick={() => toggleExpanded(c)}
                  className="font-medium text-brand hover:underline"
                >
                  {expandedId === c.id ? "Ocultar detalhes" : "Ver detalhes por contato"}
                </button>
                <span>{done} / {total} processados · {pct}%</span>
              </div>
            </div>

            {/* Tabela de contatos individuais — só busca/mostra quando o
                usuário expande, pra não pesar com polling desnecessário
                para campanhas que ninguém está olhando no momento. */}
            {expandedId === c.id && (
              <div className="mt-4 overflow-hidden rounded-lg border border-neutral-200">
                {expandedLoading && expandedJobs.length === 0 ? (
                  <p className="p-4 text-center text-sm text-neutral-500">Carregando...</p>
                ) : expandedJobs.length === 0 ? (
                  <p className="p-4 text-center text-sm text-neutral-500">Nenhum contato nessa campanha.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-neutral-50 text-left text-[11px] uppercase tracking-wide text-neutral-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">Nome</th>
                        <th className="px-3 py-2 font-medium">Número</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {expandedJobs.map((j) => (
                        <tr key={j.id}>
                          <td className="px-3 py-2 text-neutral-800">{j.name || "—"}</td>
                          <td className="px-3 py-2 text-neutral-600">{j.phone}</td>
                          <td className="px-3 py-2">
                            <span
                              className={
                                "rounded-full px-2 py-0.5 text-[11px] font-semibold " +
                                (j.status === "sent"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : j.status === "failed"
                                    ? "bg-red-100 text-red-700"
                                    : "bg-neutral-100 text-neutral-600")
                              }
                              title={j.error || undefined}
                            >
                              {j.status === "sent" ? "Enviado" : j.status === "failed" ? "Falhou" : j.status === "in_flight" ? "Enviando" : "Pendente"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        );
      })}

    </div>
  );
}

// --- Utils ---

const inputCls =
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
      <div className="rounded-xl border border-neutral-300 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-neutral-500">
              Assinantes ativos
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-4xl font-semibold leading-none tracking-tight text-neutral-950">{totalSubs}</span>
              {goal > 0 && <span className="text-4xl font-semibold leading-none tracking-tight text-neutral-400">/ {goal}</span>}
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


      <div className="space-y-5 rounded-xl border border-neutral-300 bg-white p-5 shadow-sm">


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
                    ? "border-brand bg-brand text-white"
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
              className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong"
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
          className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong"
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

      <div className="rounded-xl border border-neutral-300 bg-white p-6 shadow-sm space-y-6">
        <div className="flex items-center gap-4">
          <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-2xl bg-neutral-800 text-2xl font-semibold text-white shadow-sm">
            {logo ? <img src={logo} alt="logo" className="h-full w-full object-cover" /> : initial}
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
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
            className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-strong"
          >
            Salvar
          </button>
          {saved && <span className="text-xs font-medium text-emerald-600">Salvo ✔</span>}
        </div>
      </div>
    </div>
  );
}
