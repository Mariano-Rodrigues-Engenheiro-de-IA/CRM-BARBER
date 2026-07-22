// POST /api/public/extension/activate
//
// Trades an activation code for a raw extension token. The raw token is
// returned ONCE in the response body; only its SHA-256 hash is persisted.
// The extension is expected to store the raw token in `chrome.storage`
// and send it as `Authorization: Bearer <raw>` on every subsequent call.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { corsHeaders, jsonResponse, preflight } from "@/lib/extension-cors";
import { generateRawToken, hashToken } from "@/lib/extension-auth";

const bodySchema = z.object({
  code: z.string().min(4).max(128),
  label: z.string().min(1).max(80).optional(),
});

export const Route = createFileRoute("/api/public/extension/activate")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),
      POST: async ({ request }) => {
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return jsonResponse(request, { ok: false, error: "Invalid JSON" }, { status: 400 });
        }
        const parsed = bodySchema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(
            request,
            { ok: false, error: "Invalid body" },
            { status: 400 },
          );
        }
        const { code, label } = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: codeRow, error: codeErr } = await supabaseAdmin
          .from("activation_codes")
          .select("id, barbershop_id, expires_at, used_at")
          .eq("code", code)
          .maybeSingle();

        if (codeErr) {
          return jsonResponse(
            request,
            { ok: false, error: "Lookup failed" },
            { status: 500 },
          );
        }
        if (!codeRow) {
          return jsonResponse(
            request,
            { ok: false, error: "Código inválido" },
            { status: 404 },
          );
        }
        if (codeRow.used_at) {
          return jsonResponse(
            request,
            { ok: false, error: "Código já utilizado" },
            { status: 409 },
          );
        }
        if (new Date(codeRow.expires_at) < new Date()) {
          return jsonResponse(
            request,
            { ok: false, error: "Código expirado" },
            { status: 410 },
          );
        }

        // Resolve barbershop for the response.
        const { data: shop, error: shopErr } = await supabaseAdmin
          .from("barbershops")
          .select("id, name")
          .eq("id", codeRow.barbershop_id)
          .single();
        if (shopErr || !shop) {
          return jsonResponse(
            request,
            { ok: false, error: "Barbearia não encontrada" },
            { status: 404 },
          );
        }

        // Mint token.
        const raw = generateRawToken();
        const tokenHash = await hashToken(raw);
        const { data: tokenRow, error: tokenErr } = await supabaseAdmin
          .from("extension_tokens")
          .insert({
            barbershop_id: codeRow.barbershop_id,
            token_hash: tokenHash,
            label: label ?? "Extensão Chrome",
          })
          .select("id")
          .single();
        if (tokenErr || !tokenRow) {
          return jsonResponse(
            request,
            { ok: false, error: "Falha ao gerar token" },
            { status: 500 },
          );
        }

        // Mark code as used, pointing to the token that consumed it.
        // If this update fails we don't rollback the token (extension already
        // has it) — worst case the code shows as unused; the extension still
        // works. Log server-side for the owner to reconcile.
        const { error: usedErr } = await supabaseAdmin
          .from("activation_codes")
          .update({ used_at: new Date().toISOString(), used_token_id: tokenRow.id })
          .eq("id", codeRow.id);
        if (usedErr) {
          console.error("[activate] failed to mark code as used", usedErr);
        }

        return new Response(
          JSON.stringify({
            ok: true,
            token: raw,
            barbershop: { id: shop.id, name: shop.name },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders(request),
            },
          },
        );
      },
    },
  },
});
