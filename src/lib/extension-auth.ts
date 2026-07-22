// Extension token authentication.
//
// The extension sends `Authorization: Bearer <raw-token>`. We hash the
// incoming token (SHA-256) and look it up in `extension_tokens`. The raw
// token is never stored — only the hash. On success we return the token
// row (which carries `barbershop_id`) and stamp `last_used_at`.
//
// EVERY endpoint under `/api/public/extension/*` MUST call
// `authenticateExtension` at the top of the handler and use the returned
// `barbershop_id` as the tenant filter. Never trust a `barbershop_id`
// coming from the request body or URL — that would let a token holder
// for shop A read/write data of shop B.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type AuthedToken = {
  id: string;
  barbershop_id: string;
};

export async function hashToken(raw: string): Promise<string> {
  const encoder = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(raw));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateRawToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `ext_${b64}`;
}

export async function authenticateExtension(
  request: Request,
  supabaseAdmin: SupabaseClient<Database>,
): Promise<
  | { ok: true; token: AuthedToken }
  | { ok: false; status: number; error: string }
> {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false, status: 401, error: "Missing bearer token" };
  }
  const raw = match[1].trim();
  if (!raw) return { ok: false, status: 401, error: "Empty bearer token" };

  const tokenHash = await hashToken(raw);
  const { data, error } = await supabaseAdmin
    .from("extension_tokens")
    .select("id, barbershop_id, revoked_at, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) return { ok: false, status: 500, error: "Token lookup failed" };
  if (!data) return { ok: false, status: 401, error: "Invalid token" };
  if (data.revoked_at) return { ok: false, status: 401, error: "Token revoked" };
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return { ok: false, status: 401, error: "Token expired" };
  }

  // Fire-and-forget last_used_at bump; don't block the request.
  void supabaseAdmin
    .from("extension_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  return { ok: true, token: { id: data.id, barbershop_id: data.barbershop_id } };
}
