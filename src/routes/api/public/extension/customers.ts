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

const createSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().min(3).max(40),
  notes: z.string().max(1000).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  subscription_status: z.enum(["active", "overdue", "canceled", "lead"]).optional(),
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
        const { data, error } = await supabaseAdmin
          .from("customers")
          .select("id, name, phone, notes, tags, subscription_status, created_at, updated_at")
          .eq("barbershop_id", auth.token.barbershop_id)
          .order("created_at", { ascending: false })
          .limit(500);
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
        const { data, error } = await supabaseAdmin
          .from("customers")
          .insert({
            barbershop_id: auth.token.barbershop_id, // tenant from token, NEVER from body
            name: parsed.data.name,
            phone: parsed.data.phone,
            notes: parsed.data.notes,
            tags: parsed.data.tags,
            subscription_status: parsed.data.subscription_status ?? "active",
          })
          .select("id, name, phone, notes, tags, subscription_status, created_at")
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
