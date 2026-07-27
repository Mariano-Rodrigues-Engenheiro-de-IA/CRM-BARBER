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

type Connection = {
  status: "disconnected" | "connecting" | "connected" | "hibernated";
  phone: string | null;
  qrcode: string | null;
  provider: string;
  auth_mode?: string | null;
};

export function ConnectionView({ api }: { api: Api }) {
  const [conn, setConn] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"connect" | "disconnect" | null>(null);
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

  // Polling automático contínuo: 2.5s enquanto conectando, 10s nos demais estados.
  // Reagenda a si mesmo depois de cada refresh — sem isso o polling parava
  // no primeiro tick quando o status não mudava.
  useEffect(() => {
    clearPoll();
    if (busy) return;
    let cancelled = false;
    const schedule = () => {
      const interval = statusRef.current === "connecting" ? 2500 : 10000;
      pollRef.current = setTimeout(async () => {
        await refresh(true);
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
      const c = res.connection as Connection & {
        auth_mode?: string;
        signup?: { url?: string | null } | null;
      };
      statusRef.current = c.status;
      setAuthMode(c.auth_mode ?? null);
      setConn(c);
      // API oficial: não há QR — abre o pop-up de login da Meta.
      if (c.auth_mode === "embedded_signup" && c.signup?.url) {
        window.open(c.signup.url, "whatsapp-signup", "width=620,height=760");
      }
    } else {
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

  async function runConfirmedAction() {
    const action = confirmAction;
    setConfirmAction(null);
    if (action === "connect") await connect();
    if (action === "disconnect") await disconnect();
  }


  if (loading) {
    return <div className="rounded-2xl bg-white p-6 text-sm text-neutral-500">Carregando conexão…</div>;
  }

  const status = conn?.status ?? "disconnected";
  const isMetaConnection = conn?.provider === "meta" || conn?.auth_mode === "embedded_signup" || authMode === "embedded_signup";

  return (
    <div className="space-y-4">


      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.22em] text-neutral-500">CONEXÃO WHATSAPP</p>
            <h2 className="mt-1 text-xl font-semibold text-neutral-950">
              {status === "connected" && "Conectado"}
              {status === "connecting" && "Aguardando pareamento…"}
              {status === "disconnected" && "Desconectado"}
              {status === "hibernated" && "Hibernado"}
            </h2>
            {conn?.phone && (
              <p className="mt-1 text-sm text-neutral-500">Número: +{conn.phone}</p>
            )}
          </div>
          <StatusPill status={status} />
        </div>

        {err && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{err}</div>
        )}

        {status === "connected" && (
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmAction("disconnect")}
              disabled={busy}
              className="border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
            >
              Desconectar
            </Button>
            <p className="text-xs text-neutral-500 sm:self-center">
              WhatsApp conectado — pronto para disparar campanhas.
            </p>

          </div>
        )}

        {(status === "disconnected" || status === "hibernated") && (
          <div className="mt-6">
            <Button
              type="button"
              onClick={() => void connect()}
              disabled={busy}
              className="bg-neutral-900 text-white hover:bg-neutral-800"
            >
              {busy ? "Preparando…" : "Conectar WhatsApp"}
            </Button>
            <p className="mt-3 text-xs text-neutral-500">
              {isMetaConnection
                ? "Este número é configurado manualmente na API oficial; depois de salvar as credenciais, o status atualiza sozinho aqui."
                : "Vai gerar um QR code pra você escanear com o WhatsApp da barbearia."}
            </p>
          </div>
        )}


        {status === "connecting" && (
          <div className="mt-6">
            {conn?.qrcode ? (
              <div className="flex flex-col items-center gap-3">
                <QrImage qrcode={conn.qrcode} />
                <p className="text-center text-sm text-neutral-600">
                  Abra o WhatsApp da barbearia → Aparelhos conectados → Conectar aparelho → aponte a câmera pro código.
                </p>
              </div>
            ) : isMetaConnection ? (
              <p className="text-sm text-neutral-500">
                Este número usa a API oficial do WhatsApp — não há QR code. A conexão é liberada
                assim que o número estiver configurado e verificado. O status atualiza sozinho aqui.
              </p>
            ) : (
              <p className="text-sm text-neutral-500">Gerando QR code…</p>
            )}
            <div className="mt-4 flex gap-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void refresh(true)}
                className="border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
              >
                Atualizar agora
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setConfirmAction("disconnect")}
                className="border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </div>
      <ConnectionConfirmDialog
        action={confirmAction}
        busy={busy}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void runConfirmedAction()}
      />
    </div>
  );
}

function ConnectionConfirmDialog({
  action,
  busy,
  onCancel,
  onConfirm,
}: {
  action: "connect" | "disconnect" | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isConnect = action === "connect";
  return (
    <AlertDialog open={action !== null} onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <AlertDialogContent className="max-w-md rounded-2xl border-neutral-200 bg-white p-0 shadow-2xl">
        <AlertDialogHeader className="space-y-3 px-6 pt-6 text-left">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 text-amber-900">
            <span className="text-lg font-bold">!</span>
          </div>
          <AlertDialogTitle className="text-xl font-semibold text-neutral-950">
            {isConnect ? "Conectar WhatsApp?" : "Desconectar WhatsApp?"}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm leading-6 text-neutral-600">
            {isConnect
              ? "Vamos gerar um QR code para parear o WhatsApp da barbearia."
              : "Os disparos vão parar até você conectar o WhatsApp novamente."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 border-t border-neutral-100 bg-neutral-50 px-6 py-4 sm:space-x-0">
          <AlertDialogCancel disabled={busy} className="mt-0 border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100">
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={onConfirm}
            className="bg-neutral-950 text-white hover:bg-neutral-800"
          >
            {isConnect ? "Conectar" : "Desconectar"}
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
    return <img src={qrcode} alt="QR code" className="h-64 w-64 rounded-lg border border-neutral-200 bg-white p-2" />;
  }
  if (isBase64Png) {
    return (
      <img
        src={`data:image/png;base64,${qrcode}`}
        alt="QR code"
        className="h-64 w-64 rounded-lg border border-neutral-200 bg-white p-2"
      />
    );
  }
  // Fallback: texto cru → renderiza via serviço externo estático.
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(qrcode)}`;
  return <img src={url} alt="QR code" className="h-64 w-64 rounded-lg border border-neutral-200 bg-white p-2" />;
}
