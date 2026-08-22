// GET  /api/public/extension/lead-notes?wa_contact_id=X | ?phone=Y -> lista (mais recente primeiro)
// POST /api/public/extension/lead-notes -> cria uma nova anotação (texto e/ou mídia)

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { QUICK_REPLY_BUCKET } from "@/lib/quick-replies";

const postSchema = z
  .object({
    wa_contact_id: z.string().uuid().nullable().optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    body: z.string().trim().max(4000).nullable().optional(),
    media_path: z.string().max(400).nullable().optional(),
    media_mime: z.string().max(120).nullable().optional(),
    media_filename: z.string().max(200).nullable().optional(),
  })
  .refine((d) => !!d.body || !!d.media_path, { message: "Escreva algo ou anexe um arquivo" });

const SELECT = "id, wa_contact_id, phone, body, media_path, media_mime, media_filename, created_by, created_at";

export const Route = createFileRoute("/api/public/extension/lead-notes")({
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
        const waContactId = url.searchParams.get("wa_contact_id");
        const phone = url.searchParams.get("phone");
        if (!waContactId && !phone) {
          return jsonResponse(request, { ok: true, notes: [] });
        }
        let query = supabaseAdmin
          .from("lead_notes")
          .select(SELECT)
          .eq("barbershop_id", shop)
          .order("created_at", { ascending: false });
        query = waContactId ? query.eq("wa_contact_id", waContactId) : query.eq("phone", phone as string);
        const { data, error } = await query;
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });

        // Resolve uma URL assinada nova pra cada nota com mídia — a
        // anterior expira em 1h, então nunca guardamos ela pronta.
        const notes = await Promise.all(
          (data ?? []).map(async (n) => {
            if (!n.media_path) return { ...n, media_url: null };
            const { data: signed } = await supabaseAdmin.storage
              .from(QUICK_REPLY_BUCKET)
              .createSignedUrl(n.media_path, 60 * 60);
            return { ...n, media_url: signed?.signedUrl ?? null };
          }),
        );
        return jsonResponse(request, { ok: true, notes });
      },

      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const shop = auth.token.barbershop_id;
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return jsonResponse(request, { ok: false, error: "Invalid JSON" }, { status: 400 });
        }
        const parsed = postSchema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
        }
        const { wa_contact_id, phone, ...fields } = parsed.data;
        if (!wa_contact_id && !phone) {
          return jsonResponse(request, { ok: false, error: "Contato não identificado" }, { status: 400 });
        }
        const { data, error } = await supabaseAdmin
          .from("lead_notes")
          .insert({ barbershop_id: shop, wa_contact_id: wa_contact_id ?? null, phone: phone ?? null, ...fields })
          .select(SELECT)
          .single();
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        return jsonResponse(request, { ok: true, note: data });
      },
    },
  },
});
