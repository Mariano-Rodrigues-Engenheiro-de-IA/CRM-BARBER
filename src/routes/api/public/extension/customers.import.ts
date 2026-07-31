// POST /api/public/extension/customers/import
// Bulk-imports customers into the token's barbershop.
// Body: {
//   customers: [{ name, phone, tags?, status?, notes? }, ...],
//   mode?: 'merge' | 'replace_spreadsheet'  // default 'merge'
// }
//
// mode='merge' (default): dedup por telefone; existentes atualizam (tags mescladas),
// novos inserem. Não mexe em contatos ausentes.
//
// mode='replace_spreadsheet': cria um novo batch_id. Cada linha vira/atualiza
// customer com source='spreadsheet' e spreadsheet_batch_id=novo. Todos os
// customers com source='spreadsheet' que NÃO fazem parte do novo batch são
// arquivados (archived_at=now). Contatos manuais/WA não são afetados.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { customerStatusSchema } from "@/lib/customer-presets";

const rowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(3).max(40),
  notes: z.string().max(1000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  status: customerStatusSchema.optional(),
});

const bodySchema = z.object({
  customers: z.array(rowSchema).min(1).max(2000),
  mode: z.enum(["merge", "replace_spreadsheet"]).optional(),
  source: z.enum(["manual", "spreadsheet", "whatsapp_contacts"]).optional(),
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
        const mode = parsed.data.mode ?? "merge";
        const isReplace = mode === "replace_spreadsheet";
        const source = parsed.data.source ?? (isReplace ? "spreadsheet" : "manual");
        const batchId = isReplace ? crypto.randomUUID() : null;

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

        type InsertRow = {
          barbershop_id: string;
          name: string;
          phone: string;
          notes: string | null;
          tags: string[];
          status: string;
          source: string;
          spreadsheet_batch_id: string | null;
        };
        type UpdatePatch = {
          tags: string[];
          status?: string;
          notes?: string | null;
          name?: string;
          source?: string;
          spreadsheet_batch_id?: string | null;
          archived_at?: null;
        };
        const toInsert: InsertRow[] = [];
        const updates: Array<{ id: string; patch: UpdatePatch }> = [];

        for (const r of rows) {
          const found = byPhone.get(r.phone);
          if (found) {
            const merged = Array.from(new Set([...(found.tags ?? []), ...(r.tags ?? [])]));
            const patch: UpdatePatch = { tags: merged, archived_at: null };
            if (r.status) patch.status = r.status;
            if (r.notes !== undefined) patch.notes = r.notes;
            if (r.name) patch.name = r.name;
            if (isReplace) {
              patch.source = "spreadsheet";
              patch.spreadsheet_batch_id = batchId;
            }
            updates.push({ id: found.id, patch });
          } else {
            toInsert.push({
              barbershop_id: barbershopId,
              name: r.name,
              phone: r.phone,
              notes: r.notes ?? null,
              tags: r.tags ?? [],
              status: r.status ?? "active",
              source,
              spreadsheet_batch_id: batchId,
            });
          }
        }

        const { getBillingStatus, limitBlock } = await import("@/lib/billing.server");
        const billing = await getBillingStatus(supabaseAdmin, barbershopId);
        const blocked = limitBlock(billing, "customers", toInsert.length);
        if (blocked) {
          return jsonResponse(
            request,
            { ok: false, error: blocked, code: "limit_reached", billing },
            { status: 402 },
          );
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
            .eq("barbershop_id", barbershopId);
          if (upErr) {
            return jsonResponse(request, { ok: false, error: upErr.message }, { status: 500 });
          }
          updated += 1;
        }

        let archived = 0;
        if (isReplace && batchId) {
          // Arquiva planilhas antigas (source=spreadsheet e batch diferente).
          const { data: arch, error: archErr } = await supabaseAdmin
            .from("customers")
            .update({ archived_at: new Date().toISOString() })
            .eq("barbershop_id", barbershopId)
            .eq("source", "spreadsheet")
            .is("archived_at", null)
            .neq("spreadsheet_batch_id", batchId)
            .select("id");
          if (archErr) {
            return jsonResponse(request, { ok: false, error: archErr.message }, { status: 500 });
          }
          archived = arch?.length ?? 0;
        }

        return jsonResponse(request, {
          ok: true,
          received: rows.length,
          inserted,
          updated,
          archived,
          batch_id: batchId,
          mode,
        });
      },
    },
  },
});
