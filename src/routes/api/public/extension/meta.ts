// GET /api/public/extension/meta
// Returns preset statuses and suggested tags so the extension UI
// can render selects/chips without hardcoding the list.

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { CUSTOMER_STATUSES, DEFAULT_CUSTOMER_TAGS } from "@/lib/customer-presets";

export const Route = createFileRoute("/api/public/extension/meta")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }

        // Also surface any tags the shop has already used, so the picker
        // suggests them alongside the defaults.
        const [{ data }, shopRes] = await Promise.all([
          supabaseAdmin
            .from("customers")
            .select("tags")
            .eq("barbershop_id", auth.token.barbershop_id)
            .limit(1000),
          supabaseAdmin
            .from("barbershops")
            .select("name")
            .eq("id", auth.token.barbershop_id)
            .maybeSingle(),
        ]);
        const usedTags = new Set<string>();
        for (const row of data ?? []) {
          for (const t of row.tags ?? []) usedTags.add(t);
        }

        return jsonResponse(request, {
          ok: true,
          barbershop: { id: auth.token.barbershop_id, name: shopRes.data?.name ?? "Barbearia" },
          statuses: CUSTOMER_STATUSES,
          suggested_tags: Array.from(new Set([...DEFAULT_CUSTOMER_TAGS, ...usedTags])).sort(),
        });

      },
    },
  },
});
