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
import { CUSTOMER_STATUS_VALUES } from "@/lib/customer-presets";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().min(3).max(40),
  notes: z.string().max(1000).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  status: z.enum(CUSTOMER_STATUS_VALUES).optional(),
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
        let query = supabaseAdmin
          .from("customers")
          .select("id, name, phone, notes, tags, status, source, spreadsheet_batch_id, archived_at, created_at, updated_at")
          .eq("barbershop_id", auth.token.barbershop_id)
          .order("created_at", { ascending: false })
          .limit(2000);
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
            notes: parsed.data.notes ?? null,
            tags: parsed.data.tags ?? [],
            status: parsed.data.status ?? "active",
            source: "manual",
            spreadsheet_batch_id: null,
          })
          .select("id, name, phone, notes, tags, status, source, created_at")
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
