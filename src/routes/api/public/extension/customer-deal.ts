// GET   /api/public/extension/customer-deal?wa_contact_id=X | ?phone=Y -> busca (ou vazio)
// PATCH /api/public/extension/customer-deal -> cria ou atualiza (upsert por contato)

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const patchSchema = z.object({
  wa_contact_id: z.string().uuid().nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  stage_label: z.string().trim().max(120).nullable().optional(),
  state: z.string().trim().max(60).nullable().optional(),
  lead_source: z.string().trim().max(80).nullable().optional(),
  entry_date: z.string().trim().max(10).nullable().optional(),
  exit_date: z.string().trim().max(10).nullable().optional(),
  value_cents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  company: z.string().trim().max(160).nullable().optional(),
  role: z.string().trim().max(120).nullable().optional(),
  products_of_interest: z.string().trim().max(1000).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

const SELECT =
  "id, wa_contact_id, phone, stage_label, state, lead_source, entry_date, exit_date, value_cents, company, role, products_of_interest, notes";

export const Route = createFileRoute("/api/public/extension/customer-deal")({
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
        // Sem contato especificado: devolve todos os valores da barbearia
        // (usado pra somar o total parado em cada funil/etapa no CRM).
        if (!waContactId && !phone) {
          const { data, error } = await supabaseAdmin
            .from("customer_deals")
            .select("wa_contact_id, phone, value_cents")
            .eq("barbershop_id", shop)
            .not("value_cents", "is", null);
          if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
          return jsonResponse(request, { ok: true, deal: null, deals: data ?? [] });
        }
        let query = supabaseAdmin.from("customer_deals").select(SELECT).eq("barbershop_id", shop);
        query = waContactId && phone
          ? query.or(`wa_contact_id.eq.${waContactId},phone.eq.${phone}`)
          : waContactId
            ? query.eq("wa_contact_id", waContactId)
            : query.eq("phone", phone as string);
        const { data, error } = await query.maybeSingle();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, deal: data ?? null });
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
        let existingQuery = supabaseAdmin.from("customer_deals").select("id").eq("barbershop_id", shop);
        existingQuery = wa_contact_id ? existingQuery.eq("wa_contact_id", wa_contact_id) : existingQuery.eq("phone", phone as string);
        const { data: existing } = await existingQuery.maybeSingle();

        if (existing) {
          const { data, error } = await supabaseAdmin
            .from("customer_deals")
            .update({ ...fields, ...(wa_contact_id ? { wa_contact_id } : {}), ...(phone ? { phone } : {}) })
            .eq("id", existing.id)
            .eq("barbershop_id", shop)
            .select(SELECT)
            .single();
          if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
          return jsonResponse(request, { ok: true, deal: data });
        }
        const { data, error } = await supabaseAdmin
          .from("customer_deals")
          .insert({ barbershop_id: shop, wa_contact_id: wa_contact_id ?? null, phone: phone ?? null, ...fields })
          .select(SELECT)
          .single();
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        return jsonResponse(request, { ok: true, deal: data });
      },
    },
  },
});
