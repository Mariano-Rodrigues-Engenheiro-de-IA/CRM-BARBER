// Provider UAZAPI (não-oficial).
//
// Docs: https://docs.uazapi.com/  — v2.1.1.
// Cabeçalhos:
//   - admintoken: cria/gerencia instâncias (rota /instance/init)
//   - token: opera em uma instância específica (send, status, disconnect)
//
// Endpoints usados (podem variar por versão do servidor — ajuste aqui se
// o log mostrar 404, todo o resto do código fala pela interface):
//   POST /instance/init         { name }               -> { token, ... }
//   POST /instance/connect      (header token)          -> { qrcode, status }
//   GET  /instance/status       (header token)          -> { status, ... }
//   POST /instance/disconnect   (header token)
//   POST /send/text             { number, text }        -> { id }

import type {
  ConnectResult,
  SendResult,
  StatusResult,
  WhatsAppProvider,
  InstanceStatus,
} from "./types";

function baseUrl(): string {
  const raw = process.env.UAZAPI_BASE_URL;
  if (!raw) throw new Error("UAZAPI_BASE_URL não configurada");
  return raw.replace(/\/+$/, "");
}

function adminToken(): string {
  const t = process.env.UAZAPI_ADMIN_TOKEN;
  if (!t) throw new Error("UAZAPI_ADMIN_TOKEN não configurada");
  return t;
}

type UazResponse = Record<string, unknown> & {
  status?: string;
  state?: string;
  connectionStatus?: string;
  qrcode?: string;
  qr?: string;
  qrCode?: string;
  token?: string;
  id?: string;
  instance?: { id?: string; token?: string; status?: string; phone?: string };
  phone?: string;
  wid?: string;
  error?: string;
  message?: string;
};

async function uaz(
  path: string,
  init: { method?: string; token?: string; admin?: boolean; body?: unknown } = {},
): Promise<{ ok: boolean; status: number; data: UazResponse; raw: string }> {
  const url = `${baseUrl()}${path}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.admin) headers.admintoken = adminToken();
  if (init.token) headers.token = init.token;

  const res = await fetch(url, {
    method: init.method ?? "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const raw = await res.text();
  let data: UazResponse = {};
  try {
    data = raw ? (JSON.parse(raw) as UazResponse) : {};
  } catch {
    data = { message: raw };
  }
  return { ok: res.ok, status: res.status, data, raw };
}

function normalizeStatus(input: unknown): InstanceStatus {
  const s = String(input ?? "").toLowerCase();
  if (s.includes("connected") || s === "open" || s === "authenticated") return "connected";
  if (s.includes("connecting") || s === "qrcode" || s.includes("qr")) return "connecting";
  if (s.includes("hibernat") || s === "paused") return "hibernated";
  return "disconnected";
}

function extractQr(data: UazResponse): string | null {
  return (
    (typeof data.qrcode === "string" && data.qrcode) ||
    (typeof data.qr === "string" && data.qr) ||
    (typeof data.qrCode === "string" && data.qrCode) ||
    null
  );
}

function extractStatus(data: UazResponse): InstanceStatus {
  return normalizeStatus(
    data.status ?? data.state ?? data.connectionStatus ?? data.instance?.status,
  );
}

function extractPhone(data: UazResponse): string | null {
  const raw =
    (typeof data.phone === "string" && data.phone) ||
    (typeof data.wid === "string" && data.wid) ||
    (typeof data.instance?.phone === "string" && data.instance.phone) ||
    null;
  if (!raw) return null;
  return raw.replace(/@.*/, "").replace(/\D+/g, "") || null;
}

export const uazapiProvider: WhatsAppProvider = {
  async connect({ barbershop_id, existing_instance_id, existing_instance_token }) {
    let instance_id = existing_instance_id ?? null;
    let instance_token = existing_instance_token ?? null;

    if (!instance_id || !instance_token) {
      const init = await uaz("/instance/init", {
        method: "POST",
        admin: true,
        body: { name: `barbearia-${barbershop_id.slice(0, 8)}` },
      });
      if (!init.ok) {
        throw new Error(
          `UAZAPI init falhou (${init.status}): ${init.data.error ?? init.data.message ?? init.raw.slice(0, 200)}`,
        );
      }
      instance_token =
        (typeof init.data.token === "string" && init.data.token) ||
        init.data.instance?.token ||
        null;
      instance_id =
        (typeof init.data.id === "string" && init.data.id) ||
        init.data.instance?.id ||
        instance_id;
      if (!instance_token) {
        throw new Error("UAZAPI init: token da instância não retornado");
      }
    }

    // Pede QR / abre conexão.
    const connect = await uaz("/instance/connect", {
      method: "POST",
      token: instance_token,
      body: {},
    });

    return {
      instance_id: instance_id ?? instance_token,
      instance_token,
      status: extractStatus(connect.data),
      qrcode: extractQr(connect.data),
    };
  },

  async status({ instance_token }) {
    const res = await uaz("/instance/status", { method: "GET", token: instance_token });
    if (!res.ok && res.status !== 404) {
      throw new Error(`UAZAPI status ${res.status}: ${res.data.error ?? res.raw.slice(0, 200)}`);
    }
    const result: StatusResult = {
      status: extractStatus(res.data),
      qrcode: extractQr(res.data),
      phone: extractPhone(res.data),
    };
    return result;
  },

  async sendText({ instance_token, to, text }) {
    const number = to.replace(/\D+/g, "");
    const res = await uaz("/send/text", {
      method: "POST",
      token: instance_token,
      body: { number, text },
    });
    if (res.ok) {
      const id =
        (typeof res.data.id === "string" && res.data.id) ||
        (res.data.instance?.id as string | undefined) ||
        undefined;
      return { ok: true, provider_message_id: id };
    }
    const msg = res.data.error ?? res.data.message ?? res.raw.slice(0, 200);
    const retryable = res.status === 429 || res.status >= 500;
    return { ok: false, error: `UAZAPI ${res.status}: ${msg}`, retryable };
  },

  async disconnect({ instance_token }) {
    await uaz("/instance/disconnect", { method: "POST", token: instance_token, body: {} });
  },
};
