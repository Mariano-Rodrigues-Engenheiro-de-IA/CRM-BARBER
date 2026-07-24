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

type Api = (path: string, opts?: RequestInit) => Promise<{ ok?: boolean; error?: string; [k: string]: unknown }>;

type Connection = {
  status: "disconnected" | "connecting" | "connected" | "hibernated";
  phone: string | null;
  qrcode: string | null;
  provider: string;
};

export function ConnectionView({ api }: { api: Api }) {
  const [conn, setConn] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function refresh() {
    setErr(null);
    const res = await api("/api/public/extension/whatsapp/status");
    if (res.ok && res.connection) {
      setConn(res.connection as Connection);
    } else if (res.error) {
      setErr(res.error);
    }
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling enquanto está conectando.
  useEffect(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    if (conn?.status === "connecting") {
      pollRef.current = setTimeout(() => void refresh(), 2500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn?.status, conn?.qrcode]);

  async function connect() {
    setBusy(true);
    setErr(null);
    const res = await api("/api/public/extension/whatsapp/connect", { method: "POST" });
    setBusy(false);
    if (res.ok && res.connection) {
      setConn(res.connection as Connection);
    } else {
      setErr(res.error || "Falha ao iniciar conexão");
    }
  }

  async function disconnect() {
    if (!confirm("Desconectar o WhatsApp da barbearia? Os disparos vão parar até você reconectar.")) return;
    setBusy(true);
    await api("/api/public/extension/whatsapp/disconnect", { method: "POST" });
    setBusy(false);
    void refresh();
  }

  if (loading) {
    return <div className="rounded-2xl bg-white p-6 text-sm text-neutral-500">Carregando conexão…</div>;
  }

  const status = conn?.status ?? "disconnected";

  return (
    <div className="space-y-4">
      {/* Aviso permanente sobre risco */}
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Atenção: disparo via API não-oficial (UAZAPI).</p>
        <p className="mt-1 leading-relaxed">
          Existe risco de bloqueio do número pelo WhatsApp. Use com moderação, com mensagens variadas
          e intervalos humanos. Em breve, teremos opção de API oficial da Meta.
        </p>
      </div>

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
            <button
              onClick={disconnect}
              disabled={busy}
              className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              Desconectar
            </button>
            <p className="text-xs text-neutral-500 sm:self-center">
              Suas campanhas rodam no servidor 24/7 enquanto o WhatsApp estiver conectado.
            </p>
          </div>
        )}

        {(status === "disconnected" || status === "hibernated") && (
          <div className="mt-6">
            <button
              onClick={connect}
              disabled={busy}
              className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {busy ? "Preparando…" : "Conectar WhatsApp"}
            </button>
            <p className="mt-3 text-xs text-neutral-500">
              Vai gerar um QR code pra você escanear com o WhatsApp da barbearia.
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
            ) : (
              <p className="text-sm text-neutral-500">Gerando QR code…</p>
            )}
            <div className="mt-4 flex gap-3">
              <button
                onClick={refresh}
                className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
              >
                Atualizar agora
              </button>
              <button
                onClick={disconnect}
                className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
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
