// `state` assinado do Embedded Signup.
//
// O pop-up da Meta/BSP volta pro nosso callback por redirect do navegador,
// sem token da extensão. Levamos o barbershop_id dentro do `state` assinado
// com HMAC (WHATSAPP_SIGNUP_STATE_SECRET) e com validade curta — assim o
// callback nunca confia num barbershop_id vindo cru da URL.

import { createHmac, timingSafeEqual } from "crypto";

const TTL_MS = 30 * 60 * 1000;

function secret(): string {
  const s = process.env.WHATSAPP_SIGNUP_STATE_SECRET;
  if (!s) throw new Error("WHATSAPP_SIGNUP_STATE_SECRET não configurada");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createSignupState(barbershop_id: string): string {
  const payload = Buffer.from(JSON.stringify({ b: barbershop_id, t: Date.now() })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySignupState(state: string | null): { barbershop_id: string } | null {
  if (!state) return null;
  const [payload, mac] = state.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { b?: string; t?: number };
    if (!data.b || !data.t || Date.now() - data.t > TTL_MS) return null;
    return { barbershop_id: data.b };
  } catch {
    return null;
  }
}
