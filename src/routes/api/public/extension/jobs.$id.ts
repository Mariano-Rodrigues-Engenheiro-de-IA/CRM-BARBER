// PATCH /api/public/extension/jobs/:id
//
// The extension reports the outcome of a job it previously claimed.
// Body: { status: "sent" | "failed", error?: string }
//
// Tenant isolation: the update is scoped to the token's barbershop_id,
// so an attacker holding token of shop A cannot flip status of shop B's jobs.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const bodySchema = z.object({
  status: z.enum(["sent", "failed"]),
  error: z.string().max(500).optional(),
});

export const Route = createFileRoute("/api/public/extension/jobs/$id")({
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
        const parsed = bodySchema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: "Invalid body" }, { status: 400 });
        }

        const nowIso = new Date().toISOString();
        const patch = {
          status: parsed.data.status,
          last_error: parsed.data.error ?? null,
          sent_at: parsed.data.status === "sent" ? nowIso : null,
        };

        const { data, error } = await supabaseAdmin
          .from("message_jobs")
          .update(patch)
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id) // tenant guard
          .select("id, status")
          .maybeSingle();

        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        if (!data) {
          // Either wrong id, or the job belongs to another barbershop.
          return jsonResponse(request, { ok: false, error: "Job não encontrado" }, { status: 404 });
        }
        if (parsed.data.status === "sent") {
          const { data: job } = await supabaseAdmin
            .from("message_jobs")
            .select("customer_id, message_actions")
            .eq("id", params.id)
            .eq("barbershop_id", auth.token.barbershop_id)
            .maybeSingle();
          const actions = Array.isArray(job?.message_actions) ? job.message_actions : [];
          const funnelActions = actions.filter((action) => {
            if (!action || typeof action !== "object") return false;
            const type = (action as { type?: unknown }).type;
            return type === "funnel_add" || type === "funnel_remove";
          }) as Array<{ type: "funnel_add" | "funnel_remove"; funnel_id?: string; stage_id?: string }>;
          if (job?.customer_id && funnelActions.length) {
            const { data: customer } = await supabaseAdmin
              .from("customers")
              .select("name, phone")
              .eq("id", job.customer_id)
              .eq("barbershop_id", auth.token.barbershop_id)
              .maybeSingle();
            for (const action of funnelActions) {
              if (!action.funnel_id || !customer) continue;
              const { data: cards } = await supabaseAdmin
                .from("funnel_cards")
                .select("id, stage_id")
                .eq("barbershop_id", auth.token.barbershop_id)
                .eq("funnel_id", action.funnel_id)
                .eq("phone", customer.phone);
              if (action.type === "funnel_remove") {
                const ids = (cards ?? []).map((card) => card.id);
                if (ids.length) await supabaseAdmin.from("funnel_cards").delete().in("id", ids);
                continue;
              }
              if (!action.stage_id) continue;
              const existing = cards?.[0];
              if (existing) {
                if (existing.stage_id !== action.stage_id) {
                  await supabaseAdmin.from("funnel_cards").update({ stage_id: action.stage_id }).eq("id", existing.id);
                }
              } else {
                await supabaseAdmin.from("funnel_cards").insert({
                  barbershop_id: auth.token.barbershop_id,
                  funnel_id: action.funnel_id,
                  stage_id: action.stage_id,
                  title: customer.name,
                  phone: customer.phone,
                });
              }
            }
          }
        }
        return jsonResponse(request, { ok: true, job: data });
      },
    },
  },
});
