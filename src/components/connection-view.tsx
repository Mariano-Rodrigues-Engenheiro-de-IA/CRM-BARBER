// Aba "Conexão WhatsApp" do painel.
//
// Fluxo:
//  1. GET /api/public/extension/whatsapp/status — mostra estado atual
//  2. Se desconectado: botão "Conectar" chama POST /whatsapp/connect e
//     inicia polling do status a cada 2.5s até `connected` ou desistência.
//  3. Se conectado: mostra número + botão desconectar.
//
// Renderiza QR como string base64 (aceita `data:image/...;base64,...` ou
// texto cru). Se vier texto cru, delega renderização a `api.qrserver.com`
// como fallback visual (chamada só do lado do usuário, imagem estática).

import { useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type Api = (path: string, opts?: RequestInit) => Promise<{ ok?: boolean; error?: string; [k: string]: unknown }>;

declare global {
  interface Window {
    FB?: {
      init: (opts: { appId: string; version: string; xfbml?: boolean; autoLogAppEvents?: boolean }) => void;
      login: (
        cb: (res: { authResponse?: { code?: string } | null; status?: string }) => void,
        opts: {
          config_id: string;
          response_type: string;
          override_default_response_type: boolean;
          extras?: Record<string, unknown>;
        },
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

/** Carrega o SDK oficial do JavaScript da Meta uma única vez (cacheado em
 * window.FB). O Cadastro Incorporado exige o SDK — abrir a URL de OAuth
 * crua numa aba/pop-up manual (sem passar pelo SDK) é rejeitado pela Meta
 * com "Recurso indisponível", mesmo com as permissões certas aprovadas.
 * Snippet e versão (v26.0) seguindo exatamente a documentação oficial —
 * "SDK do JavaScript" em developers.facebook.com/apps/.../whatsapp-business. */
let fbSdkPromise: Promise<void> | null = null;
function loadFacebookSdk(appId: string): Promise<void> {
  if (window.FB) return Promise.resolve();
  if (fbSdkPromise) return fbSdkPromise;
  fbSdkPromise = new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      fbSdkPromise = null;
      reject(new Error("O SDK da Meta não carregou. Desative bloqueadores e tente novamente."));
    }, 15000);
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, version: "v26.0", xfbml: true, autoLogAppEvents: true });
      window.clearTimeout(timeout);
      resolve();
    };
    const existing = document.getElementById("facebook-jssdk");
    if (existing) {
      existing.addEventListener("error", () => {
        window.clearTimeout(timeout);
        fbSdkPromise = null;
        reject(new Error("Falha ao carregar o SDK da Meta."));
      }, { once: true });
      return;
    }
    // Padrão exato do snippet oficial "JavaScript assíncrono" da Meta:
    // insere antes do primeiro <script> existente, não no fim do body.
    const firstScript = document.getElementsByTagName("script")[0];
    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.onerror = () => {
      window.clearTimeout(timeout);
      fbSdkPromise = null;
      reject(new Error("Falha ao carregar o SDK da Meta."));
    };
    if (firstScript?.parentNode) {
      firstScript.parentNode.insertBefore(script, firstScript);
    } else {
      document.head.appendChild(script);
    }
  });
  return fbSdkPromise;
}

type Connection = {
  status: "disconnected" | "connecting" | "connected" | "hibernated";
  phone: string | null;
  qrcode: string | null;
  provider: string;
  auth_mode?: string | null;
  needs_manual_credentials?: boolean;
  last_error?: string | null;
  signup?: {
    url?: string | null;
    params?: { app_id?: string; config_id?: string } | null;
  } | null;
};

export function ConnectionView({ api }: { api: Api }) {
  const [conn, setConn] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"connect" | "disconnect" | "switch_provider" | null>(null);
  const [pendingProvider, setPendingProvider] = useState<"uazapi" | "meta" | null>(null);
  const [authMode, setAuthMode] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshSeqRef = useRef(0);
  const operationSeqRef = useRef(0);
  const actionRef = useRef<"connect" | "disconnect" | null>(null);
  const statusRef = useRef<Connection["status"]>("disconnected");

  function clearPoll() {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }

  async function refresh(force = false) {
    if (actionRef.current) return;
    const refreshSeq = ++refreshSeqRef.current;
    const operationSeq = operationSeqRef.current;
    setErr(null);
    const path = force
      ? "/api/public/extension/whatsapp/status?sync=1"
      : "/api/public/extension/whatsapp/status";
    const res = await api(path);
    if (refreshSeq !== refreshSeqRef.current || operationSeq !== operationSeqRef.current || actionRef.current) {
      setLoading(false);
      return;
    }
    if (res.ok && res.connection) {
      const next = res.connection as Connection;
      statusRef.current = next.status;
      setAuthMode(next.auth_mode ?? (next.provider === "meta" ? "embedded_signup" : null));
      setConn(next);
      setLoading(false);
      return next;
    } else if (res.error) {
      setErr(res.error);
    }
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
    return () => {
      clearPoll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling automático contínuo: 5s enquanto conectando, 10s nos demais
  // estados. Reagenda a si mesmo depois de cada refresh — sem isso o
  // polling parava no primeiro tick quando o status não mudava.
  //
  // IMPORTANTE: nunca força sincronização aqui (força só uma vez, logo
  // após o usuário completar o login) — senão todo tick do polling bate
  // direto na Graph API da Meta, ignorando o limite mínimo do backend.
  // Foi exatamente isso que já disparou rate limit da própria Meta
  // (#80008, "too many calls to this WhatsApp Business account").
  useEffect(() => {
    clearPoll();
    if (busy) return;
    let cancelled = false;
    const schedule = () => {
      const interval = statusRef.current === "connecting" ? 5000 : 10000;
      pollRef.current = setTimeout(async () => {
        await refresh(false);
        if (!cancelled) schedule();
      }, interval);
    };
    schedule();
    return () => {
      cancelled = true;
      clearPoll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  // Re-sincroniza quando a aba volta ao foco (usuário voltou da UAZAPI etc.).
  useEffect(() => {
    function onFocus() {
      if (document.visibilityState === "hidden" || actionRef.current) return;
      void refresh(true);
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listener de eventos de sessão do Cadastro Incorporado — parte obrigatória
  // da implementação oficial (não opcional): a Meta manda, pela janela que
  // abriu o FB.login, informações de progresso/erro/abandono do fluxo via
  // postMessage, além do "code" que já é tratado no callback do FB.login.
  // https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!event.origin.endsWith("facebook.com")) return;
      try {
        const data = JSON.parse(event.data);
        if (data?.type === "WA_EMBEDDED_SIGNUP") {
          console.info("[Cadastro Incorporado] evento de sessão:", data);
        }
      } catch {
        console.info("[Cadastro Incorporado] evento de sessão (texto cru):", event.data);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Integração Zero (hosted embedded signup): link pronto da Meta, sem
  // depender do SDK JS (FB.login) que só funcionava com a conta dona do
  // app. https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/hosted-es
  function openHostedSignup() {
    window.open(
      "https://business.facebook.com/messaging/whatsapp/onboard/?app_id=1608564974165087&config_id=2248207349309254",
      "_blank",
      "noopener,noreferrer",
    );
  }

  async function connect() {
    actionRef.current = "connect";

    operationSeqRef.current += 1;
    refreshSeqRef.current += 1;
    clearPoll();
    setBusy(true);
    setErr(null);
    statusRef.current = "connecting";
    setConn((prev) => ({
      status: "connecting",
      phone: prev?.phone ?? null,
      qrcode: null,
      provider: prev?.provider ?? "uazapi",
      auth_mode: prev?.auth_mode ?? authMode,
    }));
    const res = await api("/api/public/extension/whatsapp/connect", { method: "POST" });
    if (res.ok && res.connection) {
      const c = res.connection as Connection;
      statusRef.current = c.status;
      setAuthMode(c.auth_mode ?? null);
      setConn(c);
      // API oficial: não há QR — abre o Cadastro Incorporado via SDK
      // oficial da Meta (FB.login). Abrir a URL crua numa aba/pop-up manual
      // é bloqueado pela Meta com "Recurso indisponível", mesmo com as
      // permissões certas aprovadas — o SDK é obrigatório pra esse fluxo.
      if (c.auth_mode === "embedded_signup" && c.signup?.url) {
        const appId = c.signup.params?.app_id;
        const configId = c.signup.params?.config_id;
        const state = (() => {
          try {
            return new URL(c.signup!.url as string).searchParams.get("state");
          } catch {
            return null;
          }
        })();

        if (appId && configId && state) {
          try {
            await loadFacebookSdk(appId);
          } catch (sdkError) {
            actionRef.current = null;
            setBusy(false);
            statusRef.current = "disconnected";
            setErr(sdkError instanceof Error ? sdkError.message : "Falha ao carregar o SDK da Meta.");
            return;
          }
          window.FB?.login(
            (response) => {
              const code = response.authResponse?.code;
              if (!code) {
                actionRef.current = null;
                setBusy(false);
                statusRef.current = "disconnected";
                setErr("Vínculo cancelado ou não concluído no pop-up da Meta.");
                return;
              }
              // Reaproveita o mesmo endpoint de callback que já processa o
              // code, descobre a WABA e salva a conexão — só que chamado
              // via fetch em vez de redirect de página completa.
              const callbackUrl = `/api/public/whatsapp/signup-callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}&source=sdk`;
              fetch(callbackUrl)
                .catch(() => {
                  // Falha de rede pura (nem chegou a bater no servidor) — o
                  // refresh() logo abaixo ainda vai tentar buscar o status
                  // real; isso aqui é só um log, não precisa de setErr,
                  // porque senão o refresh() apaga a mensagem na hora
                  // (setErr(null) roda no início dela) antes do usuário
                  // conseguir ler.
                  console.error("[whatsapp/connect] falha de rede no callback do signup");
                })
                .finally(async () => {
                  actionRef.current = null;
                  setBusy(false);
                  // Espera o refresh terminar ANTES de decidir se mostra
                  // erro — assim a mensagem de verdade (vinda do
                  // last_error salvo no banco) não é apagada pelo
                  // setErr(null) que roda no começo do refresh().
                  const next = await refresh(true);
                  if (next && next.status !== "connected" && next.last_error) {
                    setErr(next.last_error);
                  }
                });
            },
            {
              config_id: configId,
              response_type: "code",
              override_default_response_type: true,
              // Formato v4 da documentação oficial atual (a versão anterior
              // usada aqui — feature/sessionInfoVersion/version numérico —
              // é de uma versão mais antiga do fluxo, v2/v3, e pode não ser
              // compatível com um config_id criado já na v4).
              extras: { setup: {} },
            },
          );
          return;
        } else {
          // Cadastro Incorporado não pode cair para uma URL OAuth crua: a
          // Meta exige app_id + config_id + state via SDK oficial.
          statusRef.current = "disconnected";
          setErr("Configuração incompleta do Cadastro Incorporado (app_id, config_id ou state ausente).");
        }
      }

    } else {
      statusRef.current = "disconnected";
      setConn((prev) => ({
        status: "disconnected",
        phone: prev?.phone ?? null,
        qrcode: null,
        provider: prev?.provider ?? "uazapi",
        auth_mode: prev?.auth_mode ?? authMode,
        needs_manual_credentials: prev?.needs_manual_credentials,
      }));
      setErr(res.error || "Falha ao iniciar conexão");
    }
    actionRef.current = null;
    operationSeqRef.current += 1;
    setBusy(false);
  }

  async function disconnect() {
    actionRef.current = "disconnect";
    operationSeqRef.current += 1;
    refreshSeqRef.current += 1;
    clearPoll();
    setBusy(true);
    setErr(null);
    statusRef.current = "disconnected";
    setConn((prev) => (prev ? { ...prev, status: "disconnected", phone: null, qrcode: null } : prev));
    await api("/api/public/extension/whatsapp/disconnect", { method: "POST" });
    actionRef.current = null;
    operationSeqRef.current += 1;
    setBusy(false);
  }

  function requestSwitchProvider(provider: "uazapi" | "meta") {
    const alreadyOnThisProvider = isMetaConnection ? provider === "meta" : provider === "uazapi";
    if (alreadyOnThisProvider && status === "connected") return;
    // Só pede confirmação se já tem uma conexão ativa em outro modo — trocar
    // sem estar conectado a nada não desconecta nada de verdade.
    if (status === "connected" || status === "connecting") {
      setPendingProvider(provider);
      setConfirmAction("switch_provider");
    } else {
      void switchProvider(provider);
    }
  }

  async function switchProvider(provider: "uazapi" | "meta") {
    actionRef.current = provider === "meta" ? "connect" : "disconnect";
    operationSeqRef.current += 1;
    refreshSeqRef.current += 1;
    clearPoll();
    setBusy(true);
    setErr(null);
    const res = await api("/api/public/extension/whatsapp/provider", {
      method: "POST",
      body: JSON.stringify({ provider }),
    });
    if (res.ok && res.connection) {
      const next = res.connection as Connection;
      statusRef.current = next.status;
      setAuthMode(next.auth_mode ?? (next.provider === "meta" ? "embedded_signup" : null));
      setConn(next);
      actionRef.current = null;
      operationSeqRef.current += 1;
      setBusy(false);
      // Trocar o modo sozinho não conecta nada — dispara a ação de conectar
      // correspondente na sequência, pra ficar tudo em um clique só.
      if (provider === "meta") {
        openHostedSignup();
      } else {
        void connect();
      }
      return;
    } else {
      setErr(res.error || "Falha ao trocar modo de conexão");
    }
    actionRef.current = null;
    operationSeqRef.current += 1;
    setBusy(false);
  }

  async function runConfirmedAction() {
    const action = confirmAction;
    const provider = pendingProvider;
    setConfirmAction(null);
    setPendingProvider(null);
    if (action === "connect") await connect();
    if (action === "disconnect") await disconnect();
    if (action === "switch_provider" && provider) await switchProvider(provider);
  }


  if (loading) {
    return <div className="rounded-2xl bg-white p-6 text-sm text-neutral-500">Carregando conexão…</div>;
  }

  const status = conn?.status ?? "disconnected";
  const isMetaConnection = conn?.provider === "meta" || conn?.auth_mode === "embedded_signup" || authMode === "embedded_signup";
  const needsManualCredentials = Boolean(conn?.needs_manual_credentials && isMetaConnection);
  const activeLabel = isMetaConnection ? "WhatsApp API Oficial" : "WhatsApp API não oficial";
  const activeBg = isMetaConnection ? "#009e78" : "#6366F1";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.22em] text-neutral-500">CONEXÃO WHATSAPP</p>
            {status !== "connected" && (
              <h2 className="mt-1 text-xl font-semibold text-neutral-950">
                {status === "connecting" && "Aguardando pareamento…"}
                {status === "disconnected" && "Desconectado"}
                {status === "hibernated" && "Hibernado"}
              </h2>
            )}
          </div>
          {status !== "connected" && <StatusPill status={status} />}
        </div>

        {(err || (status === "connecting" && conn?.last_error)) && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            {err || conn?.last_error}
          </div>
        )}

        {/* CONECTADO: resumo único */}
        {status === "connected" && (
          <div className="mt-5 rounded-2xl border border-green-200 bg-green-50/50 p-5">
            <div className="flex items-center gap-3">
              <WhatsAppGlyph className="h-10 w-10 shrink-0 text-white" bg={activeBg} />
              <div>
                <p className="text-base font-semibold text-neutral-950">{activeLabel}</p>
                <p className="text-sm text-neutral-500">{conn?.phone}</p>
              </div>
              <span className="ml-auto rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">
                Conectado
              </span>
            </div>
            <div className="mt-4">
              {isMetaConnection ? (
                <p className="text-xs text-neutral-500">
                  Para desconectar ou trocar de conexão, use o WhatsApp Business no seu celular:
                  Configurações, Conta, Plataforma do WhatsApp Business. Depois de desconectar por
                  lá, volte aqui para escolher a nova conexão.
                </p>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmAction("disconnect")}
                  className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
                >
                  Desconectar
                </button>
              )}
            </div>
          </div>
        )}

        {/* CONECTANDO: foco só no modo escolhido, esconde a outra opção */}
        {status === "connecting" && (
          <div className="mt-5">
            <button
              type="button"
              onClick={() => setConfirmAction("disconnect")}
              className="text-xs font-medium text-neutral-500 hover:text-neutral-700"
            >
              ← Cancelar e escolher outro modo
            </button>
            <div className="mt-3 rounded-2xl border border-brand p-5">
              <div className="flex items-center gap-3">
                <WhatsAppGlyph className="h-10 w-10 shrink-0 text-white" bg={activeBg} />
                <p className="text-base font-semibold text-neutral-950">{activeLabel}</p>
              </div>

              {conn?.qrcode ? (
                <div className="mt-4 flex flex-col items-center gap-3">
                  <QrImage qrcode={conn.qrcode} />
                  <p className="text-center text-sm text-neutral-600">
                    Abra o WhatsApp da barbearia → Aparelhos conectados → Conectar aparelho → aponte a câmera pro
                    código.
                  </p>
                </div>
              ) : isMetaConnection ? (
                needsManualCredentials ? (
                  <p className="mt-4 text-sm text-neutral-500">
                    Modo oficial selecionado, mas faltam phone_number_id e access_token configurados.
                  </p>
                ) : (
                  <p className="mt-4 text-sm text-neutral-500">
                    Completa o cadastro na aba que abriu com a Meta. O status atualiza sozinho aqui assim que
                    terminar.
                  </p>
                )
              ) : (
                <p className="mt-4 text-sm text-neutral-500">Gerando QR code…</p>
              )}
            </div>
          </div>
        )}

        {/* ESCOLHER: as duas opções lado a lado — só quando ainda não há
            conexão nenhuma (desconectado ou hibernado). */}
        {(status === "disconnected" || status === "hibernated") && (
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Modo de conexão</p>
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {/* API Oficial */}
            <div
              className={`rounded-2xl border p-5 transition ${
                isMetaConnection ? "border-brand ring-1 ring-brand" : "border-neutral-200"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <WhatsAppGlyph className="h-10 w-10 shrink-0 text-white" bg="#009e78" />
                  <p className="text-lg font-semibold text-neutral-950">
                    WhatsApp <span className="text-brand">API Oficial</span>
                  </p>
                </div>
                <MetaBusinessPartnerBadge className="hidden shrink-0 sm:block" />
              </div>

              <span className="mt-3 inline-block rounded-full border border-green-300 px-3 py-1 text-xs font-medium text-green-700">
                Recomendado
              </span>

              <p className="mt-3 text-sm text-neutral-600">
                Conexão direta com os servidores da Meta. Para empresas que querem operar WhatsApp com
                previsibilidade e escala.
              </p>

              <ul className="mt-4 space-y-2">
                <BenefitItem>Conexão oficial com a Meta</BenefitItem>
                <BenefitItem>Disparos em massa</BenefitItem>
                <BenefitItem>Funciona no celular e no computador ao mesmo tempo</BenefitItem>
              </ul>

              <button
                type="button"
                disabled={busy}
                onClick={() => requestSwitchProvider("meta")}
                className="mt-5 w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-strong"
              >
                Conectar API
              </button>
            </div>

            {/* API não oficial */}
            <div
              className={`rounded-2xl border p-5 transition ${
                !isMetaConnection ? "border-brand ring-1 ring-brand" : "border-neutral-200"
              }`}
            >
              <div className="flex items-center gap-3">
                <WhatsAppGlyph className="h-10 w-10 shrink-0 text-white" bg="#6366F1" />
                <p className="text-lg font-semibold text-neutral-950">
                  WhatsApp <span className="text-brand">API não oficial</span>
                </p>
              </div>

              <p className="mt-3 text-sm text-neutral-600">
                Espelha o WhatsApp do celular. Indicada para testes ou cenários específicos.
              </p>

              <ul className="mt-4 space-y-2">
                <BulletItem>Conexão rápida</BulletItem>
                <BulletItem>Disparos moderados</BulletItem>
                <BulletItem>Sem vínculo direto com a Meta</BulletItem>
              </ul>

              <button
                type="button"
                disabled={busy}
                onClick={() => requestSwitchProvider("uazapi")}
                className="mt-5 w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-strong"
              >
                Conectar API
              </button>
            </div>
          </div>
        </div>
        )}
      </div>
      <ConnectionConfirmDialog
        action={confirmAction}
        pendingProvider={pendingProvider}
        busy={busy}
        onCancel={() => { setConfirmAction(null); setPendingProvider(null); }}
        onConfirm={() => void runConfirmedAction()}
      />
    </div>
  );
}

function ConnectionConfirmDialog({
  action,
  pendingProvider,
  busy,
  onCancel,
  onConfirm,
}: {
  action: "connect" | "disconnect" | "switch_provider" | null;
  pendingProvider: "uazapi" | "meta" | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isConnect = action === "connect";
  const isSwitch = action === "switch_provider";
  const targetLabel = pendingProvider === "meta" ? "API Oficial" : "WhatsApp Web";

  const title = isConnect ? "Conectar WhatsApp?" : isSwitch ? "Trocar de modo de conexão?" : "Desconectar WhatsApp?";
  const description = isConnect
    ? "Vamos gerar um QR code para parear o WhatsApp da barbearia."
    : isSwitch
      ? `Isso desconecta o WhatsApp que está ativo agora, para conectar pelo modo "${targetLabel}" em seguida. Os disparos ficam parados até a nova conexão terminar.`
      : "Os disparos vão parar até você conectar o WhatsApp novamente.";
  const confirmLabel = isConnect ? "Conectar" : isSwitch ? "Trocar mesmo assim" : "Desconectar";

  return (
    <AlertDialog open={action !== null} onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <AlertDialogContent className="max-w-md rounded-2xl border-neutral-200 bg-white p-0 shadow-2xl">
        <AlertDialogHeader className="space-y-3 px-6 pt-6 text-left">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 text-amber-900">
            <span className="text-lg font-bold">!</span>
          </div>
          <AlertDialogTitle className="text-xl font-semibold text-neutral-950">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-sm leading-6 text-neutral-600">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 border-t border-neutral-100 bg-neutral-50 px-6 py-4 sm:space-x-0">
          <AlertDialogCancel disabled={busy} className="mt-0 border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100">
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={onConfirm}
            className="bg-brand text-white hover:bg-brand-strong"
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function StatusPill({ status }: { status: Connection["status"] }) {
  const map: Record<Connection["status"], { label: string; cls: string }> = {
    connected: { label: "Ativo", cls: "bg-emerald-100 text-emerald-800" },
    connecting: { label: "Conectando", cls: "bg-amber-100 text-amber-800" },
    disconnected: { label: "Offline", cls: "bg-neutral-200 text-neutral-700" },
    hibernated: { label: "Hibernado", cls: "bg-neutral-200 text-neutral-700" },
  };
  const { label, cls } = map[status];
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  );
}

function QrImage({ qrcode }: { qrcode: string }) {
  const isDataUrl = qrcode.startsWith("data:image");
  const isBase64Png = /^[A-Za-z0-9+/=]+$/.test(qrcode) && qrcode.length > 200;
  if (isDataUrl) {
    return <img src={qrcode} alt="QR code" className="h-64 w-64 rounded-xl border border-neutral-300 bg-white p-2" />;
  }
  if (isBase64Png) {
    return (
      <img
        src={`data:image/png;base64,${qrcode}`}
        alt="QR code"
        className="h-64 w-64 rounded-xl border border-neutral-300 bg-white p-2"
      />
    );
  }
  // Fallback: texto cru → renderiza via serviço externo estático.
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(qrcode)}`;
  return <img src={url} alt="QR code" className="h-64 w-64 rounded-xl border border-neutral-300 bg-white p-2" />;
}

/** Ícone do WhatsApp (balão de fala + telefone), em círculo colorido. */
function WhatsAppGlyph({ className, bg }: { className?: string; bg: string }) {
  return (
    <span
      className={`flex items-center justify-center rounded-full ${className ?? ""}`}
      style={{ backgroundColor: bg }}
    >
      <svg viewBox="0 0 32 32" fill="none" className="h-[58%] w-[58%]">
        <path
          d="M16 4C9.373 4 4 9.373 4 16c0 2.24.617 4.34 1.688 6.135L4 28l6.03-1.653A11.94 11.94 0 0 0 16 28c6.627 0 12-5.373 12-12S22.627 4 16 4Z"
          fill="white"
        />
        <path
          d="M12.4 10.4c-.267-.6-.48-.614-.734-.626-.187-.008-.4-.007-.614-.007-.213 0-.56.08-.853.4-.293.32-1.12 1.093-1.12 2.667s1.147 3.093 1.307 3.307c.16.213 2.213 3.547 5.467 4.827 2.707 1.067 3.253.854 3.84.8.587-.053 1.894-.773 2.16-1.52.267-.746.267-1.386.187-1.52-.08-.133-.293-.213-.613-.373-.32-.16-1.894-.934-2.187-1.04-.293-.107-.507-.16-.72.16-.213.32-.827 1.04-1.014 1.253-.187.213-.373.24-.693.08-.32-.16-1.348-.497-2.567-1.586-.949-.847-1.59-1.894-1.777-2.214-.187-.32-.02-.493.14-.653.144-.144.32-.373.48-.56.16-.187.213-.32.32-.533.107-.213.053-.4-.027-.56-.08-.16-.708-1.76-.987-2.41Z"
          fill={bg}
        />
      </svg>
    </span>
  );
}

/** Selo oficial da Meta (imagem, recortada e redimensionada). */
function MetaBusinessPartnerBadge({ className }: { className?: string }) {
  return (
    <img
      src="/meta-badge.png"
      alt="Meta"
      className={`h-14 w-auto object-contain ${className ?? ""}`}
    />
  );
}

function BenefitItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm text-neutral-700">
      <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.707-9.293a1 1 0 0 0-1.414-1.414L9 10.586 7.707 9.293a1 1 0 0 0-1.414 1.414l2 2a1 1 0 0 0 1.414 0l4-4Z"
          clipRule="evenodd"
        />
      </svg>
      {children}
    </li>
  );
}

function BulletItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-sm text-neutral-600">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-400" />
      {children}
    </li>
  );
}
