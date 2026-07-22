// POST /api/public/extension/customers/import
// Bulk-imports customers into the token's barbershop.
// Body: { customers: [{ name, phone, tags?, status?, notes? }, ...] }
// Dedupe: existing customers (same barbershop_id + phone) are UPDATED
// (tags merged, status/notes overwritten if provided); new ones inserted.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { CUSTOMER_STATUS_VALUES } from "@/lib/customer-presets";

const rowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(3).max(40),
  notes: z.string().max(1000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  status: z.enum(CUSTOMER_STATUS_VALUES).optional(),
});

const bodySchema = z.object({
  customers: z.array(rowSchema).min(1).max(1000),
});

export const Route = createFileRoute("/api/public/extension/customers/import")({
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
          return jsonResponse(
            request,
            { ok: false, error: "Invalid body", details: parsed.error.flatten() },
            { status: 400 },
          );
        }

        const barbershopId = auth.token.barbershop_id;
        const rows = parsed.data.customers;

        // Load existing customers by phone for dedupe
        const phones = Array.from(new Set(rows.map((r) => r.phone)));
        const { data: existing, error: exErr } = await supabaseAdmin
          .from("customers")
          .select("id, phone, tags")
          .eq("barbershop_id", barbershopId)
          .in("phone", phones);
        if (exErr) {
          return jsonResponse(request, { ok: false, error: exErr.message }, { status: 500 });
        }
        const byPhone = new Map((existing ?? []).map((c) => [c.phone, c]));

        const toInsert: Array<Record<string, unknown>> = [];
        const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];

        for (const r of rows) {
          const found = byPhone.get(r.phone);
          if (found) {
            const merged = Array.from(new Set([...(found.tags ?? []), ...(r.tags ?? [])]));
            const patch: Record<string, unknown> = { tags: merged };
            if (r.status) patch.status = r.status;
            if (r.notes !== undefined) patch.notes = r.notes;
            if (r.name) patch.name = r.name;
            updates.push({ id: found.id, patch });
          } else {
            toInsert.push({
              barbershop_id: barbershopId,
              name: r.name,
              phone: r.phone,
              notes: r.notes ?? null,
              tags: r.tags ?? [],
              status: r.status ?? "active",
            });
          }
        }

        let inserted = 0;
        if (toInsert.length > 0) {
          const { error: insErr, count } = await supabaseAdmin
            .from("customers")
            .insert(toInsert, { count: "exact" });
          if (insErr) {
            return jsonResponse(request, { ok: false, error: insErr.message }, { status: 500 });
          }
          inserted = count ?? toInsert.length;
        }

        let updated = 0;
        for (const u of updates) {
          const { error: upErr } = await supabaseAdmin
            .from("customers")
            .update(u.patch)
            .eq("id", u.id)
            .eq("barbershop_id", barbershopId); // defense-in-depth
          if (upErr) {
            return jsonResponse(request, { ok: false, error: upErr.message }, { status: 500 });
          }
          updated += 1;
        }

        return jsonResponse(request, {
          ok: true,
          received: rows.length,
          inserted,
          updated,
        });
      },
    },
  },
});
