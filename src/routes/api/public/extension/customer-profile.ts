// GET   /api/public/extension/customer-profile?wa_contact_id=X | ?phone=Y -> busca (ou vazio)
// PATCH /api/public/extension/customer-profile -> cria ou atualiza (upsert por contato)

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const patchSchema = z.object({
  wa_contact_id: z.string().uuid().nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  name: z.string().trim().max(160).nullable().optional(),
  email: z.string().trim().max(160).nullable().optional(),
  gender: z.string().trim().max(40).nullable().optional(),
  birth_date: z.string().trim().max(10).nullable().optional(),
  language: z.string().trim().max(40).nullable().optional(),
  country: z.string().trim().max(80).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  avatar_url: z.string().max(500000).nullable().optional(),
});

const SELECT = "id, wa_contact_id, phone, name, email, gender, birth_date, language, country, city, avatar_url, ai_summary, ai_summary_updated_at";

export const Route = createFileRoute("/api/public/extension/customer-profile")({
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
          return jsonResponse(request, { ok: true, profile: null });
        }
        let query = supabaseAdmin.from("customer_profiles").select(SELECT).eq("barbershop_id", shop);
        query = waContactId && phone
          ? query.or(`wa_contact_id.eq.${waContactId},phone.eq.${phone}`)
          : waContactId
            ? query.eq("wa_contact_id", waContactId)
            : query.eq("phone", phone as string);
        const { data, error } = await query.maybeSingle();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, profile: data ?? null });
      },

      PATCH: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const shop = auth.token.barbershop_id;
        const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
        }
        const { wa_contact_id, phone, ...fields } = parsed.data;
        if (!wa_contact_id && !phone) {
          return jsonResponse(request, { ok: false, error: "Contato não identificado" }, { status: 400 });
        }
        let existingQuery = supabaseAdmin.from("customer_profiles").select("id").eq("barbershop_id", shop);
        existingQuery = wa_contact_id ? existingQuery.eq("wa_contact_id", wa_contact_id) : existingQuery.eq("phone", phone as string);
        const { data: existing } = await existingQuery.maybeSingle();

        if (existing) {
          const { data, error } = await supabaseAdmin
            .from("customer_profiles")
            .update({ ...fields, ...(wa_contact_id ? { wa_contact_id } : {}), ...(phone ? { phone } : {}) })
            .eq("id", existing.id)
            .eq("barbershop_id", shop)
            .select(SELECT)
            .single();
          if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
          return jsonResponse(request, { ok: true, profile: data });
        }
        const { data, error } = await supabaseAdmin
          .from("customer_profiles")
          .insert({ barbershop_id: shop, wa_contact_id: wa_contact_id ?? null, phone: phone ?? null, ...fields })
          .select(SELECT)
          .single();
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        return jsonResponse(request, { ok: true, profile: data });
      },
    },
  },
});
