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
import { TemplatesView } from "@/components/templates-view";
import { FunnelsView } from "@/components/funnels-view";
import { DispatchCenter } from "@/components/dispatch-view";
import { sendWaAction, isRealPhone, openWhatsappChat, applyFunnelActions } from "@/lib/wa-actions";

import { sendableActions, type QuickReply } from "@/lib/quick-replies";
import { type BillingStatus } from "@/lib/billing";

import { useConfirm } from "@/components/confirm-dialog";
import { api, apiViaExtension, EXTENSION_BRIDGE_TOKEN } from "@/lib/painel-api";
import { CampaignsView } from "@/components/painel-campaigns-view";
import { KanbanView, inputCls } from "@/components/painel-kanban";
import { OverviewView, SettingsView } from "@/components/painel-settings-view";
import {
  IconBadgeCheck,
  IconRankingBars,
  IconUsers,
  IconTrophy,
  IconGear,
  IconChart,
  IconChevron,
  IconLock,
  IconSend,
  IconMegaphone,
  IconCalendar,
  IconPlug,
  IconGraduationCap,
  IconRobot,
  IconWhatsapp,
  IconNote,
  IconClock,
  IconScissors,
} from "@/components/painel-icons";
import { AgendaView } from "@/components/agenda-view";
import { AgendaRemindersView } from "@/components/agenda-reminders-view";
import { FollowupView } from "@/components/followup-view";
import { PostsaleView } from "@/components/postsale-view";
import { PatientsView } from "@/components/patients-view";
import { AulasView } from "@/components/aulas-view";
import { CampaignsMarketplaceView } from "@/components/campaigns-marketplace-view";
import { AgenteIaView } from "@/components/agente-ia-view";
import { ServicesTab } from "@/components/services-tab";
import { ProfessionalsTab } from "@/components/professionals-tab";
import { ProductsTab } from "@/components/products-tab";
import { GeneralSettingsTab } from "@/components/agenda-settings-dialog";
import { AccountTab } from "@/components/account-tab";
import { CustomersTab } from "@/components/customers-tab";
import { isClinicNiche } from "@/lib/business-niche";
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

export type Customer = {
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

export type Col = { key: string; label: string };

const COLUMNS: Col[] = [
  { key: "active", label: "Ativos" },
  { key: "due_soon", label: "A vencer" },
  { key: "overdue", label: "Inadimplentes" },
  { key: "reactivate", label: "Reativar" },
  { key: "canceled", label: "Cancelados" },
];

// Kanbans da barbearia: NÃO existem colunas padrão. Elas nascem da planilha
// importada (uma coluna por status encontrado) ou da criação manual.
function colsKey(shopId: string) {
  return `crm_cols_${shopId || "default"}`;
}

/** Colunas visíveis: só as criadas pelo usuário/importação. */
export function visibleColumns(shopId: string): Col[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(colsKey(shopId));
    const parsed = raw ? (JSON.parse(raw) as Col[]) : null;
    if (Array.isArray(parsed)) return parsed.filter((c) => c && c.key && c.label);
  } catch {
    /* ignora json inválido */
  }
  return [];
}

export function writeColumns(shopId: string, cols: Col[]) {
  localStorage.setItem(colsKey(shopId), JSON.stringify(cols));
}

/** Rótulo amigável para um status vindo da planilha. */
function statusLabel(key: string) {
  const known = COLUMNS.find((c) => c.key === key);
  if (known) return known.label;
  return key
    .replace(/^custom_/, "")
    .replace(/_/g, " ")
    .replace(/^./, (m) => m.toUpperCase());
}

/**
 * Após importar a planilha, a estrutura de kanbans espelha a estrutura dela:
 * um kanban por status presente, na ordem em que aparecem.
 */
export function syncColumnsFromSheet(shopId: string, statusKeys: string[]) {
  const cols = statusKeys.map((key) => ({ key, label: statusLabel(key) }));
  if (cols.length) writeColumns(shopId, cols);
  return cols;
}

/** Cache entre navegações: voltar pra Assinantes não pisca "Carregando...". */
let customersCache: Customer[] | null = null;

const TOKEN_KEY = "crm_ext_token_v1";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const q = url.searchParams.get("token");
  // Link dedicado "Minha agenda" (Configurações > Gerais), pensado pra
  // ser salvo como atalho na tela de início do celular — o token
  // PRECISA continuar na URL depois do carregamento, senão um atalho
  // salvo alguns instantes depois de abrir (quando a limpeza abaixo já
  // rodou) fica sem credencial nenhuma, e ao reabrir o ícone mais tarde
  // depende do localStorage ter persistido nesse mesmo contexto — o que
  // nem sempre acontece, dando tela branca. Caso real reportado pelo
  // usuário (19/09).
  const isMobileAgendaLink = url.searchParams.get("mobile") === "agenda";
  if (q) {
    if (!isMobileAgendaLink) {
      url.searchParams.delete("token");
      window.history.replaceState({}, "", url.toString());
    }
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

export function nudgeExtensionPoll() {
  if (typeof window === "undefined") return;
  window.postMessage({ __crm: "poll_now_v180" }, window.location.origin);
}

type Section =
  | "agenda"
  | "agente-ia"
  | "treinamento"
  | "configuracoes"
  | "assinantes"
  | "funis"
  | "follow-up"
  | "pos-venda"
  | "disparo"
  | "campanhas"
  | "equipe"
  | "conexao"
  | "templates"
  | "pacientes";

/** Sub-abas da sanfona de Assinaturas. */
type AssinTab = "visao" | "assinantes";
/** Sub-abas da sanfona de Configurações. */
type ConfigTab = "servicos" | "produtos" | "profissionais" | "clientes" | "gerais" | "conta";
/** Sub-abas da sanfona de Agenda. */
type AgendaTab = "agenda" | "lembretes";


/** Prévia "trancada" dos Funis — a aba abre normalmente (só as ações
 * dentro é que ficam bloqueadas), mostrando uma amostra visual de como
 * funciona (esmaecida, sem interação nenhuma) em vez do kanban de
 * verdade. Qualquer clique abre o aviso discreto (PremiumInlinePopup). */
/** Aviso pequeno e discreto — dispara quando a pessoa tenta USAR algo
 * premium (criar, salvar), não quando só entra na aba. Texto mínimo, sem
 * explicar o "porquê" — só avisa e dá o caminho, pra não travar a
 * experiência de quem só está espiando. */
function PremiumInlinePopup({
  onClose,
  onUpgrade,
}: {
  onClose: () => void;
  onUpgrade: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/10 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[280px] rounded-2xl bg-white p-4 text-center shadow-xl animate-premium-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl bg-teal-600 text-white shadow-md shadow-teal-600/25">
          <IconLock />
        </div>
        <p className="mt-2.5 text-[13px] text-neutral-600">
          Para usar esse recurso, compre a versão Premium.
        </p>
        <button
          onClick={onUpgrade}
          className="mt-3 w-full rounded-xl bg-teal-600 py-2.5 text-xs font-extrabold uppercase tracking-wide text-white transition hover:bg-teal-700"
        >
          Comprar Premium
        </button>
      </div>
    </div>
  );
}

/** Deixa a tela real visível (não interativa) por baixo, e captura
 * QUALQUER clique pra mostrar o aviso discreto em vez da ação de
 * verdade acontecer — assim a pessoa vê a tela inteira (o "gostinho"),
 * só não consegue criar/salvar nada sem assinar. */
function PremiumSoftLock({
  active,
  onUpgrade,
  children,
}: {
  active: boolean;
  onUpgrade: () => void;
  children: React.ReactNode;
}) {
  const [showPopup, setShowPopup] = useState(false);
  if (!active) return <>{children}</>;
  return (
    <div className="relative">
      <div className="pointer-events-none select-none">{children}</div>
      <div className="absolute inset-0 z-10 cursor-pointer" onClick={() => setShowPopup(true)} />
      {showPopup && (
        <PremiumInlinePopup
          onClose={() => setShowPopup(false)}
          onUpgrade={() => {
            setShowPopup(false);
            onUpgrade();
          }}
        />
      )}
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  right,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="print:hidden sticky top-0 z-10 border-b border-neutral-200 bg-white/95 backdrop-blur mt-14 md:mt-0">
      <div className="flex items-center gap-3 px-5 py-3">
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <div className="truncate text-[15px] font-semibold text-neutral-900">{title}</div>
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


/** Aviso "Tutorial" que leva direto pro módulo de treinamento
 * correspondente — usado no cabeçalho de seções que têm um vídeo
 * dedicado (hoje: Disparo). Gradiente azul (cor da marca) → preto,
 * bolinha branca com pulso contínuo (efeito "ao vivo"), ícone de
 * formatura no final — mesmo ícone da aba Treinamentos
 * (IconGraduationCap). */
function TrainingBadge({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-2 rounded-full border border-white/20 bg-gradient-to-r from-brand to-neutral-900 px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-md transition hover:border-white/40 hover:brightness-125"
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
      </span>
      {label}
      <IconGraduationCap />
    </button>
  );
}


export type Brand = { name?: string; logo?: string };
function brandKey(shopId: string) {
  return `crm_brand_${shopId || "default"}`;
}
function readBrand(shopId: string): Brand {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(brandKey(shopId)) || "{}") || {};
  } catch {
    return {};
  }
}
function writeBrand(shopId: string, data: Brand) {
  localStorage.setItem(brandKey(shopId), JSON.stringify(data));
}

// Sistema de assinatura escolhido na configuração inicial (por barbearia).
function systemKey(shopId: string) {
  return `crm_subsystem_${shopId || "default"}`;
}
export function readSystem(shopId: string): SubscriptionSystemId | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(systemKey(shopId));
  if (v === "frisar") return "frizzar"; // migração do nome antigo
  return v === "appbarber" || v === "cashbarber" || v === "frizzar" || v === "manual" ? v : null;
}
export function writeSystem(shopId: string, id: SubscriptionSystemId) {
  localStorage.setItem(systemKey(shopId), id);
}

function Painel() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>(() => customersCache ?? []);
  const [loading, setLoading] = useState(false);

  const initialSection: Section = (() => {
    if (typeof window === "undefined") return "agenda";
    const s = new URLSearchParams(window.location.search).get("section");
    if (
      s === "agenda" ||
      s === "agente-ia" ||
      s === "treinamento" ||
      s === "configuracoes" ||
      s === "equipe" ||
      s === "conexao" ||
      s === "funis" ||
      s === "follow-up" ||
      s === "pos-venda" ||
      s === "disparo" ||
      s === "campanhas" ||
      s === "assinantes" ||
      s === "templates" ||
      s === "pacientes"
    )
      return s;
    return "agenda";
  })();
  const [section, setSection] = useState<Section>(initialSection);
  // Título do módulo de treinamento a abrir automaticamente ao entrar na
  // aba Aulas — usado pelos ícones "Aula: ..." espalhados por outras
  // abas (Disparo, e futuramente outras). Não é um ID fixo: busca por
  // título (ver AulasView), continua funcionando mesmo se o módulo for
  // reordenado/editado depois.
  const [pendingTrainingModule, setPendingTrainingModule] = useState<string | null>(null);
  function openTraining(moduleTitle: string) {
    setPendingTrainingModule(moduleTitle);
    setSection("treinamento");
  }
  // Campanha salva "Usar campanha" (aba Campanhas) — leva direto pro
  // Disparo, já com essa campanha pré-selecionada como mensagem.
  const [pendingSavedCampaignId, setPendingSavedCampaignId] = useState<string | null>(null);
  function useCampaignInDispatch(campaignId: string) {
    setPendingSavedCampaignId(campaignId);
    setDisparoTab("novo");
    setSection("disparo");
  }
  // Modo "só agenda" — usado pelo link dedicado de Configurações >
  // Gerais ("Minha agenda"), pra abrir SÓ a Agenda no celular, sem o
  // menu inteiro do sistema. Detectado uma vez, não muda durante a
  // sessão (não precisa ser state).
  const mobileAgendaOnly =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("mobile") === "agenda";
  const [assinTab, setAssinTab] = useState<AssinTab>("assinantes");
  const [configTab, setConfigTab] = useState<ConfigTab>("servicos");
  const [agendaTab, setAgendaTab] = useState<AgendaTab>("agenda");
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
  // Pacientes precisa de bastante espaço (odontograma é bem largo por
  // dentro) — recolhe o menu sozinho ao entrar ali, mas a pessoa ainda
  // pode reabrir manualmente se quiser (o botão continua funcionando
  // normal).
  useEffect(() => {
    if (section === "pacientes") setSidebarCollapsed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  const [disparoTab, setDisparoTab] = useState<"novo" | "campanhas">("novo");
  // Host do cabeçalho dos funis: o seletor de funil + "novo funil" moram na
  // barra superior, mas o estado deles vive dentro do FunnelsView (portal).
  const [funisHeaderEl, setFunisHeaderEl] = useState<HTMLDivElement | null>(null);
  const [pacientesHeaderEl, setPacientesHeaderEl] = useState<HTMLDivElement | null>(null);
  // Host do cabeçalho de Assinantes: os botões de ação moram na barra do topo,
  // ao lado do título, liberando altura pros kanbans.
  const [assinHeaderEl, setAssinHeaderEl] = useState<HTMLDivElement | null>(null);
  const [equipeHeaderEl, setEquipeHeaderEl] = useState<HTMLDivElement | null>(null);
  const [shop, setShop] = useState<{ id: string; name: string; logo_url?: string | null } | null>(
    null,
  );
  const [isAdmin, setIsAdmin] = useState(() => {
    // Cache leve em sessionStorage — sem isso, a aba "Modelos" só aparece
    // depois de duas chamadas de rede resolverem (essa e a de baixo),
    // enquanto as outras abas já aparecem de cara. Isso fazia a aba
    // "sumir e reaparecer" a cada F5. Aqui já usamos o último valor
    // confirmado enquanto a checagem de verdade roda por baixo.
    try {
      return sessionStorage.getItem("crm_is_admin") === "1";
    } catch {
      return false;
    }
  });
  const [isMetaProvider, setIsMetaProvider] = useState(() => {
    try {
      return sessionStorage.getItem("crm_is_meta_provider") === "1";
    } catch {
      return false;
    }
  });
  const [billing, setBilling] = useState<BillingStatus | null>(() => {
    // Mesmo padrão do isAdmin/isMetaProvider acima - sem isso, a aba
    // Assinatura (e qualquer outra que dependa de billing) sempre
    // mostrava carregando de novo a cada F5/nova entrada no CRM, mesmo
    // com o valor de segundos atrás ainda válido. Achado de bug real
    // reportado pelo Mariano.
    try {
      const raw = sessionStorage.getItem("crm_billing");
      return raw ? (JSON.parse(raw) as BillingStatus) : null;
    } catch {
      return null;
    }
  });
  // Vazio, não "barbearia" — se começasse com um nicho pré-definido, a
  // barra lateral mostraria Assinaturas/Ranking (ou qualquer outro
  // nicho) por um instante antes do valor de verdade chegar do
  // servidor, e sumir logo depois. Achado de bug real: exatamente esse
  // pisca-pisca que o Mariano viu ao recarregar a página com nicho
  // "outros". Com string vazia, a barra não mostra nada da parte
  // condicionada por nicho até saber a resposta certa.
  const [businessType, setBusinessType] = useState<string>(() => {
    // Mesmo padrão do isAdmin/isMetaProvider/billing - achado de bug
    // real: sem isso, as abas Ranking e Assinaturas (só aparecem pra
    // business_type "barbearia") ficavam escondidas do início de toda
    // entrada no CRM até essa checagem de rede resolver, dando a
    // sensação de "essas duas abas demoram a aparecer" (reportado pelo
    // Mariano, cuja própria conta é barbearia).
    try {
      return sessionStorage.getItem("crm_business_type") || "";
    } catch {
      return "";
    }
  });
  const [showFunnelMovePopup, setShowFunnelMovePopup] = useState(false);
  const [showTemplateCreatePopup, setShowTemplateCreatePopup] = useState(false);
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
      if (r?.ok) {
        const admin = Boolean(r.is_admin);
        setIsAdmin(admin);
        try {
          sessionStorage.setItem("crm_is_admin", admin ? "1" : "0");
        } catch {
          /* sessionStorage indisponível (modo privado etc.) — sem cache, sem problema */
        }
      }
    });
    api(token, "/api/public/extension/whatsapp/status").then((r) => {
      if (r?.ok && r.connection) {
        const meta =
          (r.connection as { provider?: string; status?: string }).provider === "meta" &&
          (r.connection as { provider?: string; status?: string }).status === "connected";
        setIsMetaProvider(meta);
        try {
          sessionStorage.setItem("crm_is_meta_provider", meta ? "1" : "0");
        } catch {
          /* idem */
        }
      }
    });
    api(token, "/api/public/extension/billing").then((r) => {
      if (r?.ok && r.billing) {
        setBilling(r.billing as BillingStatus);
        try {
          sessionStorage.setItem("crm_billing", JSON.stringify(r.billing));
        } catch {
          /* sessionStorage indisponível — sem cache, sem problema */
        }
      }
      if (r?.ok && typeof r.business_type === "string") {
        setBusinessType(r.business_type);
        try {
          sessionStorage.setItem("crm_business_type", r.business_type);
        } catch {
          /* sessionStorage indisponível — sem cache, sem problema */
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Trava de segurança: esconder o link no menu não impede alguém de
  // cair direto numa URL com ?section=equipe (ou já estar nela antes do
  // nicho mudar) — o CONTEÚDO da seção não tinha guarda nenhuma. Achado
  // de bug real: Mariano escolheu "outros" e ainda viu Assinaturas/
  // Ranking, porque só o menu tinha sido corrigido antes, não o
  // conteúdo. Assim que o nicho de verdade chega (billing carrega),
  // tira a pessoa de uma seção que não faz sentido pra ela.
  useEffect(() => {
    // Só redireciona quando businessType já chegou de verdade (não
    // vazio) - achado de bug real: esse efeito disparava também no
    // instante inicial, com businessType ainda vazio (carregando),
    // tratando "ainda não sei" como "não é barbearia" e tirando a
    // pessoa de Ranking/Assinaturas antes do valor real (que podia ser
    // "barbearia" mesmo) chegar da rede - reportado pelo Mariano, cuja
    // própria conta é barbearia e ainda assim caía em Agenda.
    if (!businessType) return;
    const isBarbeariaOnly = section === "assinantes" || section === "equipe";
    const isClinicOnly = section === "pacientes";
    if (isBarbeariaOnly && businessType !== "barbearia") setSection("agenda");
    if (isClinicOnly && !isClinicNiche(businessType)) setSection("agenda");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessType]);

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
            Abra este painel pela extensão do CRM no WhatsApp Web. O botão manda você pra cá já
            autenticado.
          </p>
        </div>
      </div>
    );
  }

  const shopName =
    brand.name ||
    shop?.name ||
    (isClinicNiche(businessType)
      ? "Sua clínica"
      : businessType === "barbearia"
        ? "Sua barbearia"
        : "Seu negócio");

  /** Abre o checkout do Premium em nova aba, já identificando a barbearia. */
  function openCheckout() {
    // ⚠️ Corrigido (23/09): estava fixo em "premium" (R$ 97, plano
    // antigo) — desde a decisão de empacotar o Agente de IA nos planos
    // novos (commit 79cd5ef), o preço vigente é o "premium_197". Bug
    // real reportado pelo usuário: botão de dentro do painel (esse
    // aqui) mandava R$97 no checkout, diferente do link da landing
    // page (Plans.tsx no IA-BARBER-ATENDIMENTO), que já estava certo.
    const params = new URLSearchParams({ plano: "premium_197" });
    // Manda os dois quando disponíveis (não só um OU outro) — mais chance
    // de a página /assinar reconhecer a conta na hora e pular a etapa de
    // formulário, direto pro checkout.
    const raw = localStorage.getItem(TOKEN_KEY);
    if (raw && raw.startsWith("ext_")) params.set("token", raw);
    if (shop?.id) params.set("shop", shop.id);
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
    children?: Array<{ key: AssinTab | ConfigTab | AgendaTab; label: string }>;
  }> = [
    {
      key: "agenda",
      label: "Agenda",
      icon: <IconCalendar />,
      children: [
        { key: "agenda", label: "Minha agenda" },
        { key: "lembretes", label: "Lembretes / Confirmações" },
      ],
    },
    { key: "funis", label: "Funis de Vendas", icon: <IconChart /> },
    { key: "follow-up", label: "Follow-up", icon: <IconClock /> },
    { key: "pos-venda", label: "Pós-venda / Retorno", icon: <IconScissors /> },
    { key: "disparo", label: "Disparo", icon: <IconSend /> },
    { key: "campanhas", label: "Campanhas", icon: <IconMegaphone /> },
    ...(isClinicNiche(businessType)
      ? [{ key: "pacientes" as Section, label: "Pacientes", icon: <IconUsers /> }]
      : businessType === "barbearia"
        ? [
            {
              key: "assinantes" as Section,
              label: "Assinaturas",
              icon: <IconBadgeCheck />,
              children: [
                { key: "visao" as AssinTab, label: "Visão geral" },
                { key: "assinantes" as AssinTab, label: "Assinantes" },
              ],
            },
            { key: "equipe" as Section, label: "Ranking de vendas", icon: <IconRankingBars /> },
          ]
        : []), // "outros": CRM genérico, sem Pacientes nem Assinaturas/Ranking
    ...(isMetaProvider
      ? [{ key: "templates" as Section, label: "Modelos", icon: <IconNote /> }]
      : []),

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
        { key: "clientes", label: isClinicNiche(businessType) ? "Importar pacientes" : "Clientes" },
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
      {!mobileAgendaOnly && (
        <aside
          className={
            "print:hidden hidden md:flex h-full shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200 " +
            (sidebarCollapsed ? "w-[68px]" : "w-64")
          }
        >
          <div
            className={
              "flex pt-5 pb-4 " +
              (sidebarCollapsed
                ? "flex-col items-center gap-2 px-2"
                : "items-center justify-between pl-6 pr-3")
            }
          >
            <div
              className={
                "relative flex h-9 shrink-0 items-center transition-[width] duration-200 " +
                (sidebarCollapsed ? "w-9 justify-center" : "w-36 justify-start")
              }
            >
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
                <path
                  d="M12.5 4l-6 6 6 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
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
                              (active
                                ? "text-white/70"
                                : "text-sidebar-foreground/40 group-hover:text-sidebar-foreground/80")
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
                        const isSubActive =
                          n.key === "assinantes"
                            ? assinTab === sub.key
                            : n.key === "configuracoes"
                              ? configTab === sub.key
                              : n.key === "agenda"
                                ? agendaTab === sub.key
                                : false;
                        return (
                          <button
                            key={sub.key}
                            onClick={() => {
                              setSection(n.key);
                              if (n.key === "assinantes") setAssinTab(sub.key as AssinTab);
                              else if (n.key === "configuracoes")
                                setConfigTab(sub.key as ConfigTab);
                              else if (n.key === "agenda") setAgendaTab(sub.key as AgendaTab);
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
        </aside>
      )}

      {/* Mobile top bar — no modo "só agenda" (link dedicado), mostra só
       * o toggle Agenda/Lembretes, sem o menu completo do sistema. */}
      <div className="print:hidden md:hidden fixed top-0 inset-x-0 z-30 flex items-center justify-between border-b border-sidebar-border bg-sidebar text-sidebar-foreground px-4 py-3">
        <img src="/brand/zaylo-logo.png" alt="CRM Zaylo" className="h-7 w-auto object-contain" />
        {mobileAgendaOnly ? (
          <div className="flex gap-1 rounded-lg bg-sidebar-accent/40 p-1">
            {(["agenda", "lembretes"] as const).map((key) => (
              <button
                key={key}
                onClick={() => setAgendaTab(key)}
                className={
                  "rounded-md px-2.5 py-1 text-[11px] font-medium " +
                  (agendaTab === key ? "bg-brand text-white" : "text-sidebar-foreground/70")
                }
              >
                {key === "agenda" ? "Agenda" : "Lembretes"}
              </button>
            ))}
          </div>
        ) : (
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
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 h-full overflow-x-auto overflow-y-auto">
        {(section === "agenda" || mobileAgendaOnly) && token && (
          <>
            <SectionHeader
              icon={<IconCalendar />}
              title="Agenda"
              subtitle={agendaTab === "lembretes" ? "Lembretes / Confirmações" : undefined}
            />
            <main className="px-4 py-4">
              {agendaTab === "agenda" ? (
                <AgendaView
                  api={(path: string, opts?: RequestInit) => api(token, path, opts)}
                  businessType={businessType}
                  token={token}
                />
              ) : (
                <PremiumSoftLock active={!!billing && !billing.premium} onUpgrade={openCheckout}>
                  <AgendaRemindersView
                    api={(path: string, opts?: RequestInit) => api(token, path, opts)}
                  />
                </PremiumSoftLock>
              )}
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
                      {[
                        "Vendas",
                        "Agendamentos",
                        "Atendimento 24 horas",
                        "Humanização",
                        "Fidelização",
                      ].map((word) => (
                        <span
                          key={word}
                          className="flex items-center text-[13px] font-semibold uppercase tracking-widest text-white"
                        >
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
                <span className="text-white">
                  <IconGraduationCap />
                </span>
                <h1 className="truncate text-[15px] font-medium leading-tight text-white">
                  Treinamentos
                </h1>
              </div>
            </header>
            <main className="px-4 py-6">
              <AulasView
                api={(path: string, opts?: RequestInit) => api(token, path, opts)}
                openModuleTitle={pendingTrainingModule ?? undefined}
              />
            </main>
          </>
        )}

        {section === "campanhas" && token && (
          <>
            <SectionHeader icon={<IconMegaphone />} title="Campanhas" />
            <CampaignsMarketplaceView
              api={(path: string, opts?: RequestInit) => api(token, path, opts)}
              isMetaProvider={isMetaProvider}
              onUseCampaign={useCampaignInDispatch}
            />
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
                (configTab === "clientes" &&
                  (isClinicNiche(businessType) ? "Importar pacientes" : "Clientes")) ||
                (configTab === "gerais" && "Gerais") ||
                (configTab === "conta" && "Minha conta") ||
                undefined
              }
            />
            <main className="px-4 py-4">
              {configTab === "servicos" && (
                <ServicesTab api={(path: string, opts?: RequestInit) => api(token, path, opts)} />
              )}
              {configTab === "produtos" && (
                <ProductsTab api={(path: string, opts?: RequestInit) => api(token, path, opts)} />
              )}
              {configTab === "profissionais" && (
                <ProfessionalsTab
                  api={(path: string, opts?: RequestInit) => api(token, path, opts)}
                />
              )}
              {configTab === "clientes" && (
                <CustomersTab
                  api={(path: string, opts?: RequestInit) => api(token, path, opts)}
                  businessType={businessType}
                />
              )}
              {configTab === "gerais" && (
                <GeneralSettingsTab
                  api={(path: string, opts?: RequestInit) => api(token, path, opts)}
                  mobileAgendaLink={
                    typeof window !== "undefined" && token
                      ? `${window.location.origin}/painel/agenda/${encodeURIComponent(token)}`
                      : undefined
                  }
                />
              )}
              {configTab === "conta" && (
                <AccountTab api={(path: string, opts?: RequestInit) => api(token, path, opts)} />
              )}
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
              title={<TrainingBadge label="Tutorial" onClick={() => openTraining("Disparo")} />}
              right={
                <nav className="flex shrink-0 gap-1 rounded-lg bg-neutral-100 p-1">
                  {(["novo", "campanhas"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setDisparoTab(t)}
                      className={
                        "rounded-md px-3 py-1.5 text-xs font-medium transition " +
                        (disparoTab === t
                          ? "bg-white text-neutral-900 shadow-sm"
                          : "text-neutral-500 hover:text-neutral-900")
                      }
                    >
                      {t === "novo" ? "Novo disparo" : "Histórico"}
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
                  isBarbearia={businessType === "barbearia"}
                  pendingSavedCampaignId={pendingSavedCampaignId}
                  onPendingSavedCampaignConsumed={() => setPendingSavedCampaignId(null)}
                />
              )}
              {disparoTab === "campanhas" && <CampaignsView token={token} />}
            </main>
          </>
        )}

        {section === "funis" && token && (
          <>
            <header className="print:hidden sticky top-0 z-10 border-b border-neutral-200 bg-white/95 backdrop-blur mt-14 md:mt-0">
              <div className="flex items-center gap-3 px-5 py-2.5">
                <div ref={setFunisHeaderEl} className="flex min-w-0 flex-1 items-center gap-2" />
              </div>
            </header>
            <main className="px-4 py-3">
              <FunnelsView
                api={(path: string, opts?: RequestInit) => api(token, path, opts)}
                headerHost={funisHeaderEl}
                premiumLocked={!!billing && !billing.premium}
                onBlockedMove={() => setShowFunnelMovePopup(true)}
              />
            </main>
            {showFunnelMovePopup && (
              <PremiumInlinePopup
                onClose={() => setShowFunnelMovePopup(false)}
                onUpgrade={() => {
                  setShowFunnelMovePopup(false);
                  openCheckout();
                }}
              />
            )}
          </>
        )}

        {section === "follow-up" && token && (
          <>
            <SectionHeader icon={<IconClock />} title="Follow-up" />
            <main className="px-4 py-4">
              <PremiumSoftLock active={!!billing && !billing.premium} onUpgrade={openCheckout}>
                <FollowupView api={(path: string, opts?: RequestInit) => api(token, path, opts)} />
              </PremiumSoftLock>
            </main>
          </>
        )}

        {section === "pos-venda" && token && (
          <>
            <SectionHeader icon={<IconScissors />} title="Pós-venda / Retorno" />
            <main className="px-4 py-4">
              <PremiumSoftLock active={!!billing && !billing.premium} onUpgrade={openCheckout}>
                <PostsaleView api={(path: string, opts?: RequestInit) => api(token, path, opts)} />
              </PremiumSoftLock>
            </main>
          </>
        )}

        {section === "pacientes" && token && (
          <>
            <header className="print:hidden sticky top-0 z-10 border-b border-neutral-200 bg-white/95 backdrop-blur mt-14 md:mt-0">
              <div className="flex items-center gap-3 px-5 py-2.5">
                <div
                  ref={setPacientesHeaderEl}
                  className="flex min-w-0 flex-1 items-center gap-2"
                />
              </div>
            </header>
            <main className="px-4 py-4">
              <PatientsView
                api={(path: string, opts?: RequestInit) => api(token, path, opts)}
                customers={customers}
                clinicName={shopName}
                clinicLogo={shop?.logo_url ?? undefined}
                headerHost={pacientesHeaderEl}
                onPatientCreated={() => reload(true)}
                businessType={businessType}
              />
            </main>
          </>
        )}

        {section === "equipe" && token && (
          <>
            <SectionHeader
              icon={<IconRankingBars />}
              title="Ranking de vendas"
              right={<div ref={setEquipeHeaderEl} className="flex shrink-0 items-center gap-2" />}
            />
            <main className="px-4 py-4">
              <PremiumSoftLock active={!!billing && !billing.premium} onUpgrade={openCheckout}>
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
              </PremiumSoftLock>
            </main>
          </>
        )}

        {section === "conexao" && token && (
          <>
            <SectionHeader
              title={<TrainingBadge label="Tutorial" onClick={() => openTraining("Conexão")} />}
            />
            <main className="max-w-3xl px-4 py-4">
              <ConnectionView
                api={(path: string, opts?: RequestInit) => api(token, path, opts)}
                businessType={businessType}
              />
            </main>
          </>
        )}

        {section === "templates" && token && isMetaProvider && (
          <>
            <main className="max-w-6xl px-4 py-4">
              <TemplatesView
                api={(path: string, opts?: RequestInit) => api(token, path, opts)}
                premiumLocked={!!billing && !billing.premium}
                onBlockedCreate={() => setShowTemplateCreatePopup(true)}
              />
            </main>
            {showTemplateCreatePopup && (
              <PremiumInlinePopup
                onClose={() => setShowTemplateCreatePopup(false)}
                onUpgrade={() => {
                  setShowTemplateCreatePopup(false);
                  openCheckout();
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
