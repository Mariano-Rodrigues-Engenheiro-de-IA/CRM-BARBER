// PATCH  /api/public/extension/customers/:id  -> update status/tags/name
// DELETE /api/public/extension/customers/:id  -> soft-delete (archived_at = now)
//
// Tenant isolation: barbershop_id vem SEMPRE do token. O :id só é aceito
// se pertencer à mesma barbearia; caso contrário 404.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { customerStatusSchema } from "@/lib/customer-presets";
import { normalizePhone } from "@/lib/subscription-systems";

const patchSchema = z.object({
  status: customerStatusSchema.optional(),
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().min(8).max(25).optional(),
  email: z.string().trim().email().max(160).nullable().optional(),
  birth_date: z.string().trim().max(20).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const Route = createFileRoute("/api/public/extension/customers/$id")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      PATCH: async ({ request, params }) => {
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
        const parsed = patchSchema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(
            request,
            { ok: false, error: "Invalid body", details: parsed.error.flatten() },
            { status: 400 },
          );
        }
        const patch: {
          status?: string;
          name?: string;
          phone?: string;
          email?: string | null;
          birth_date?: string | null;
          address?: string | null;
          tags?: string[];
          notes?: string | null;
        } = { ...parsed.data };
        // Telefone informado à mão substitui o placeholder "sem-tel-..." da planilha.
        if (parsed.data.phone !== undefined) {
          const digits = normalizePhone(parsed.data.phone);
          if (!digits) {
            return jsonResponse(request, { ok: false, error: "Telefone inválido" }, { status: 400 });
          }
          patch.phone = digits;
          const { data: current } = await supabaseAdmin
            .from("customers")
            .select("tags")
            .eq("id", params.id)
            .eq("barbershop_id", auth.token.barbershop_id)
            .maybeSingle();
          if (current?.tags && parsed.data.tags === undefined) {
            patch.tags = current.tags.filter((t: string) => t !== "sem-telefone");
          }
        }
        const { data, error } = await supabaseAdmin
          .from("customers")
          .update(patch)
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id)
          .select("id, name, phone, email, birth_date, address, status, tags, notes")
          .maybeSingle();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        if (!data) {
          return jsonResponse(request, { ok: false, error: "Not found" }, { status: 404 });
        }
        return jsonResponse(request, { ok: true, customer: data });
      },

      DELETE: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const { data, error } = await supabaseAdmin
          .from("customers")
          .update({ archived_at: new Date().toISOString() })
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id)
          .is("archived_at", null)
          .select("id")
          .maybeSingle();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        if (!data) {
          return jsonResponse(request, { ok: false, error: "Not found" }, { status: 404 });
        }
        return jsonResponse(request, { ok: true });
      },
    },
  },
});
