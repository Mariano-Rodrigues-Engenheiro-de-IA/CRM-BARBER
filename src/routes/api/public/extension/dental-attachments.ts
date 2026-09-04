// GET  /api/public/extension/dental-attachments?customer_id=X -> lista (com URL assinada pra cada arquivo)
// POST /api/public/extension/dental-attachments -> envia um arquivo novo (base64, mesmo padrão já usado pra capa de treinamento)

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const BUCKET = "dental-attachments";
// Base64 infla ~33% o tamanho — 15MB de payload cobre um arquivo de
// origem de uns 11MB, folga suficiente pra radiografia/PDF comum sem
// deixar o corpo da requisição gigante.
const MAX_BASE64_LENGTH = 15_000_000;

const postSchema = z.object({
  customer_id: z.string().uuid(),
  file_name: z.string().trim().min(1).max(200),
  content_type: z.string().trim().min(1).max(120),
  base64: z.string().min(1).max(MAX_BASE64_LENGTH),
});

export const Route = createFileRoute("/api/public/extension/dental-attachments")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const shop = auth.token.barbershop_id;
        const url = new URL(request.url);
        const customerId = url.searchParams.get("customer_id");
        if (!customerId) {
          return jsonResponse(request, { ok: false, error: "Falta o parâmetro customer_id." }, { status: 400 });
        }
        const { data, error } = await supabaseAdmin
          .from("dental_attachments")
          .select("id, file_name, content_type, size_bytes, file_path, created_at")
          .eq("barbershop_id", shop)
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false });
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });

        // Bucket privado — cada arquivo precisa de uma URL assinada
        // própria, válida por 1h, gerada na hora da listagem.
        const withUrls = await Promise.all(
          (data ?? []).map(async (row) => {
            const { data: signed } = await supabaseAdmin.storage
              .from(BUCKET)
              .createSignedUrl(row.file_path, 3600);
            return { ...row, url: signed?.signedUrl ?? null };
          }),
        );
        return jsonResponse(request, { ok: true, attachments: withUrls });
      },

      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const shop = auth.token.barbershop_id;
        const parsed = postSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
        }
        const { data: customer } = await supabaseAdmin
          .from("customers")
          .select("id")
          .eq("id", parsed.data.customer_id)
          .eq("barbershop_id", shop)
          .maybeSingle();
        if (!customer) {
          return jsonResponse(request, { ok: false, error: "Paciente não encontrado." }, { status: 404 });
        }

        const bytes = Buffer.from(parsed.data.base64, "base64");
        const safeName = parsed.data.file_name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${shop}/${parsed.data.customer_id}/${Date.now()}-${safeName}`;
        const { error: uploadErr } = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, {
          contentType: parsed.data.content_type,
          upsert: false,
        });
        if (uploadErr) return jsonResponse(request, { ok: false, error: uploadErr.message }, { status: 500 });

        const { data, error } = await supabaseAdmin
          .from("dental_attachments")
          .insert({
            barbershop_id: shop,
            customer_id: parsed.data.customer_id,
            file_path: path,
            file_name: parsed.data.file_name,
            content_type: parsed.data.content_type,
            size_bytes: bytes.length,
          })
          .select("id, file_name, content_type, size_bytes, file_path, created_at")
          .single();
        if (error) {
          // Já subiu o arquivo mas a linha no banco falhou — remove o
          // órfão do storage, senão fica lixo lá sem nenhum registro.
          await supabaseAdmin.storage.from(BUCKET).remove([path]).catch(() => undefined);
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 3600);
        return jsonResponse(request, { ok: true, attachment: { ...data, url: signed?.signedUrl ?? null } });
      },
    },
  },
});
