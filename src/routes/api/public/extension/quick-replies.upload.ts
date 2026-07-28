// POST /api/public/extension/quick-replies/upload
// Recebe { filename, mime, data_base64 } e grava no bucket privado
// `quick-reply-media`, devolvendo { path, url } (URL assinada por 1h).

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { QUICK_REPLY_BUCKET } from "@/lib/quick-replies";

const MAX_BYTES = 16 * 1024 * 1024; // 16 MB

const bodySchema = z.object({
  filename: z.string().trim().min(1).max(200),
  mime: z.string().trim().min(3).max(120),
  data_base64: z.string().min(8).max(24_000_000),
});

function decodeBase64(input: string): Uint8Array {
  const clean = input.includes(",") ? input.slice(input.indexOf(",") + 1) : input;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const Route = createFileRoute("/api/public/extension/quick-replies/upload")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return jsonResponse(request, { ok: false, error: "Invalid JSON" }, { status: 400 });
        }
        const parsed = bodySchema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: "Dados inválidos" }, { status: 400 });
        }
        if (!/^(image|video|audio)\//.test(parsed.data.mime)) {
          return jsonResponse(
            request,
            { ok: false, error: "Tipo de arquivo não suportado" },
            { status: 400 },
          );
        }
        let bytes: Uint8Array;
        try {
          bytes = decodeBase64(parsed.data.data_base64);
        } catch {
          return jsonResponse(request, { ok: false, error: "Base64 inválido" }, { status: 400 });
        }
        if (bytes.byteLength > MAX_BYTES) {
          return jsonResponse(request, { ok: false, error: "Arquivo maior que 16 MB" }, { status: 400 });
        }

        const safeName = parsed.data.filename.replace(/[^\w.\-]+/g, "_").slice(-80);
        const path = `${auth.token.barbershop_id}/${crypto.randomUUID()}-${safeName}`;
        const { error } = await supabaseAdmin.storage
          .from(QUICK_REPLY_BUCKET)
          .upload(path, bytes, { contentType: parsed.data.mime, upsert: false });
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        const { data: signed } = await supabaseAdmin.storage
          .from(QUICK_REPLY_BUCKET)
          .createSignedUrl(path, 60 * 60);
        return jsonResponse(request, {
          ok: true,
          path,
          url: signed?.signedUrl ?? null,
          mime: parsed.data.mime,
          filename: safeName,
        });
      },
    },
  },
});
