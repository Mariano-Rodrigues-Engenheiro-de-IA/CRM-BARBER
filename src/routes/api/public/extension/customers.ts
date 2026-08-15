// GET  /api/public/extension/customers  -> list customers of the token's barbershop
// POST /api/public/extension/customers  -> create a customer in the token's barbershop
//
// Tenant isolation: barbershop_id is ALWAYS derived from the authenticated
// token, never from the request body or query string. Any barbershop_id
// present in the payload is ignored.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { customerStatusSchema } from "@/lib/customer-presets";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().min(3).max(40),
  email: z.string().trim().email().max(160).optional().or(z.literal("")),
  birth_date: z.string().max(20).optional().or(z.literal("")),
  address: z.string().trim().max(300).optional(),
  notes: z.string().max(1000).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  status: customerStatusSchema.optional(),
  is_subscriber: z.boolean().optional(),
});

export const Route = createFileRoute("/api/public/extension/customers")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const url = new URL(request.url);
        const includeArchived = url.searchParams.get("include_archived") === "1";
        const phoneFilter = url.searchParams.get("phone");
        let query = supabaseAdmin
          .from("customers")
          .select("id, name, phone, email, birth_date, address, notes, tags, status, source, is_subscriber, spreadsheet_batch_id, archived_at, created_at, updated_at, ai_summary, ai_summary_updated_at")
          .eq("barbershop_id", auth.token.barbershop_id)
          .order("created_at", { ascending: false });
        if (phoneFilter) {
          // Consulta leve por um cliente especifico (ex: pra mostrar o
          // resumo da IA num card do funil) — não pagina os 2000.
          query = query.eq("phone", phoneFilter.replace(/\D/g, "")).limit(1);
        } else {
          query = query.limit(2000);
        }
        if (!includeArchived) query = query.is("archived_at", null);
        const { data, error } = await query;
        if (error) {
          return jsonResponse(request, { ok: false, error: "Query failed" }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, customers: data });
      },

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
        const parsed = createSchema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(
            request,
            { ok: false, error: "Invalid body", details: parsed.error.flatten() },
            { status: 400 },
          );
        }
        const { getBillingStatus, limitBlock } = await import("@/lib/billing.server");
        const billing = await getBillingStatus(supabaseAdmin, auth.token.barbershop_id);
        const blocked = limitBlock(billing, "customers", 1);
        if (blocked) {
          return jsonResponse(
            request,
            { ok: false, error: blocked, code: "limit_reached", billing },
            { status: 402 },
          );
        }

        const { data, error } = await supabaseAdmin
          .from("customers")
          .insert({
            barbershop_id: auth.token.barbershop_id, // tenant from token, NEVER from body
            name: parsed.data.name,
            phone: parsed.data.phone,
            email: parsed.data.email || null,
            birth_date: parsed.data.birth_date || null,
            address: parsed.data.address || null,
            notes: parsed.data.notes ?? null,
            tags: parsed.data.tags ?? [],
            status: parsed.data.status ?? "active",
            is_subscriber: parsed.data.is_subscriber ?? false,
            source: "manual",
            spreadsheet_batch_id: null,
          })
          .select("id, name, phone, email, birth_date, address, notes, tags, status, source, is_subscriber, created_at")
          .single();
        if (error) {
          return jsonResponse(
            request,
            { ok: false, error: error.message },
            { status: 500 },
          );
        }
        return jsonResponse(request, { ok: true, customer: data }, { status: 201 });
      },
    },
  },
});
