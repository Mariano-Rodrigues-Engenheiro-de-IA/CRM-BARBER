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
  status?: unknown;
  state?: string;
  connectionStatus?: string;
  connection?: string;
  connected?: boolean;
  loggedIn?: boolean;
  qrcode?: string;
  qr?: string;
  qrCode?: string;
  token?: string;
  id?: string;
  instance?: Record<string, unknown> & { id?: string; token?: string; status?: string; phone?: string };
  phone?: string;
  wid?: string;
  error?: string;
  message?: string;
};

type UazStatusPayload = {
  connected?: boolean;
  loggedIn?: boolean;
  jid?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
  if (isRecord(input)) {
    const statusPayload = input as UazStatusPayload;
    if (statusPayload.connected === true || statusPayload.loggedIn === true) return "connected";
    if (statusPayload.connected === false || statusPayload.loggedIn === false) return "disconnected";
  }
  const s = String(input ?? "").toLowerCase();
  if (
    s.includes("disconnect") ||
    s.includes("not connected") ||
    s.includes("not_connected") ||
    s === "closed" ||
    s === "close" ||
    s === "offline" ||
    s === "logout" ||
    s === "loggedout" ||
    s === "logged_out"
  ) return "disconnected";
  if (s === "connected" || s === "open" || s === "authenticated" || s === "loggedin" || s === "logged_in") return "connected";
  if (
    s.includes("connecting") ||
    s === "qrcode" ||
    s.includes("qr") ||
    s === "pending" ||
    s.includes("pair") ||
    s.includes("scan") ||
    s.includes("login")
  ) return "connecting";
  if (s.includes("hibernat") || s === "paused") return "hibernated";
  return "disconnected";
}

function extractQr(data: UazResponse): string | null {
  const seen = new Set<unknown>();
  const findQr = (value: unknown, depth = 0): string | null => {
    if (depth > 5 || value === null || value === undefined || seen.has(value)) return null;
    if (typeof value === "string") return null;
    if (Array.isArray(value)) {
      seen.add(value);
      for (const item of value) {
        const nested = findQr(item, depth + 1);
        if (nested) return nested;
      }
      return null;
    }
    if (!isRecord(value)) return null;
    seen.add(value);
    for (const [key, raw] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      const isQrKey = normalizedKey === "qr" || normalizedKey.includes("qrcode") || normalizedKey.includes("qrimage");
      if (isQrKey && typeof raw === "string" && raw.trim().length > 0) return raw.trim();
      if (isQrKey && isRecord(raw)) {
        for (const candidateKey of ["base64", "image", "url", "code", "value"]) {
          const candidate = raw[candidateKey];
          if (typeof candidate === "string" && candidate.trim().length > 0) return candidate.trim();
        }
      }
    }
    for (const raw of Object.values(value)) {
      const nested = findQr(raw, depth + 1);
      if (nested) return nested;
    }
    return null;
  };
  const direct = findQr(data);
  if (direct) {
    if (direct.startsWith("data:image")) return direct;
    const base64Prefix = direct.match(/^data:image\/[^;]+;base64,(.+)$/i)?.[1];
    return base64Prefix ?? direct;
  }
  return null;
}

function extractStatus(data: UazResponse, qrcode: string | null = extractQr(data)): InstanceStatus {
  const candidates = [data.status, data, data.instance?.status, data.state, data.connectionStatus, data.connection];
  const normalized = candidates.map((candidate) => normalizeStatus(candidate));
  if (normalized.includes("connected")) return "connected";
  if (qrcode) return "connecting";
  if (normalized.includes("connecting")) return "connecting";
  if (normalized.includes("hibernated")) return "hibernated";
  return "disconnected";
}

function extractPhone(data: UazResponse): string | null {
  const statusPayload = isRecord(data.status) ? (data.status as UazStatusPayload) : null;
  const raw =
    (typeof data.phone === "string" && data.phone) ||
    (typeof data.wid === "string" && data.wid) ||
    (typeof data.instance?.owner === "string" && data.instance.owner) ||
    (typeof data.instance?.phone === "string" && data.instance.phone) ||
    (typeof statusPayload?.jid === "string" && statusPayload.jid) ||
    null;
  if (!raw) return null;
  return raw.split("@")[0]?.split(":")[0]?.replace(/\D+/g, "") || null;
}

function summarizeUaz(path: string, response: { status: number; data: UazResponse; raw: string }) {
  const keys = Object.keys(response.data).slice(0, 20);
  const instanceKeys = isRecord(response.data.instance) ? Object.keys(response.data.instance).slice(0, 20) : [];
  return {
    path,
    statusCode: response.status,
    status: response.data.status ?? response.data.state ?? response.data.connectionStatus ?? response.data.connection,
    message: response.data.error ?? response.data.message,
    keys,
    instanceKeys,
    rawSize: response.raw.length,
  };
}

async function initInstance(barbershop_id: string, fallbackInstanceId: string | null) {
  const init = await uaz("/instance/init", {
    method: "POST",
    admin: true,
    body: { name: `barbearia-${barbershop_id.slice(0, 8)}-${Date.now().toString(36)}` },
  });
  if (!init.ok) {
    throw new Error(
      `UAZAPI init falhou (${init.status}): ${init.data.error ?? init.data.message ?? init.raw.slice(0, 200)}`,
    );
  }
  const instance_token =
    (typeof init.data.token === "string" && init.data.token) ||
    (typeof init.data.instance?.token === "string" && init.data.instance.token) ||
    null;
  const instance_id =
    (typeof init.data.id === "string" && init.data.id) ||
    (typeof init.data.instance?.id === "string" && init.data.instance.id) ||
    fallbackInstanceId;
  if (!instance_token) {
    throw new Error("UAZAPI init: token da instância não retornado");
  }
  return { instance_id, instance_token };
}

export const uazapiProvider: WhatsAppProvider = {
  name: "uazapi",
  authMode: "qr",


  async connect({ barbershop_id, existing_instance_id, existing_instance_token }) {
    let instance_id = existing_instance_id ?? null;
    let instance_token = existing_instance_token ?? null;

    if (!instance_id || !instance_token) {
      const fresh = await initInstance(barbershop_id, instance_id);
      instance_id = fresh.instance_id;
      instance_token = fresh.instance_token;
    }

    // Pede QR / abre conexão.
    let connect = await uaz("/instance/connect", {
      method: "POST",
      token: instance_token,
      body: {},
    });
    if (!connect.ok && connect.status === 401) {
      console.warn("[uazapi/connect] token antigo inválido; criando nova instância", summarizeUaz("/instance/connect", connect));
      const fresh = await initInstance(barbershop_id, null);
      instance_id = fresh.instance_id;
      instance_token = fresh.instance_token;
      connect = await uaz("/instance/connect", {
        method: "POST",
        token: instance_token,
        body: {},
      });
    }
    if (!connect.ok) {
      throw new Error(
        `UAZAPI connect falhou (${connect.status}): ${connect.data.error ?? connect.data.message ?? connect.raw.slice(0, 200)}`,
      );
    }

    let qrcode = extractQr(connect.data);
    let status = extractStatus(connect.data, qrcode);
    if (!qrcode && status !== "connected") {
      const synced = await uaz("/instance/status", { method: "GET", token: instance_token });
      if (synced.ok) {
        qrcode = extractQr(synced.data) ?? qrcode;
        status = extractStatus(synced.data, qrcode);
      }
      if (!qrcode && status !== "connected") {
        console.warn("[uazapi/connect] QR ausente", {
          connect: summarizeUaz("/instance/connect", connect),
          status: synced.ok ? summarizeUaz("/instance/status", synced) : summarizeUaz("/instance/status", synced),
        });
      }
    }

    return {
      instance_id: instance_id ?? instance_token,
      instance_token,
      status,
      qrcode,
    };
  },

  async status({ instance_token }) {
    const res = await uaz("/instance/status", { method: "GET", token: instance_token });
    if (!res.ok && res.status !== 404) {
      throw new Error(`UAZAPI status ${res.status}: ${res.data.error ?? res.raw.slice(0, 200)}`);
    }
    const qrcode = extractQr(res.data);
    const status = extractStatus(res.data, qrcode);

    const result: StatusResult = {
      status,
      qrcode,
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
