// POST /api/public/extension/campaigns
// Cria uma campanha e enfileira message_jobs em uma única chamada.
//
// Body:
// {
//   name: string,
//   message: string,                    // corpo já renderizado (MVP: sem placeholders)
//   pace_seconds?: number,              // ritmo entre disparos, default 30
//   customer_ids?: string[],            // alvo explícito por id, OU
//   filter?: { status?: string, tags?: string[] } // resolve dinamicamente
// }
//
// Tenant isolation: barbershop_id vem SEMPRE do token; qualquer valor no
// body é ignorado. TTL de 48h aplicado em cada job (regra do plano).

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { CUSTOMER_STATUS_VALUES } from "@/lib/customer-presets";

const bodySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(4000),
    pace_seconds: z.number().int().min(5).max(600).optional(),
    customer_ids: z.array(z.string().uuid()).max(1000).optional(),
    filter: z
      .object({
        status: z.enum(CUSTOMER_STATUS_VALUES).optional(),
        tags: z.array(z.string().min(1).max(40)).max(10).optional(),
      })
      .optional(),
  })
  .refine((v) => (v.customer_ids && v.customer_ids.length > 0) || v.filter, {
    message: "Informe customer_ids ou filter",
  });

const TTL_HOURS = 48;

export const Route = createFileRoute("/api/public/extension/campaigns")({
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
        const { name, message, pace_seconds, customer_ids, filter } = parsed.data;

        // Resolve alvo → lista de customers {id, phone}
        let customersQ = supabaseAdmin
          .from("customers")
          .select("id, phone")
          .eq("barbershop_id", barbershopId);

        if (customer_ids && customer_ids.length > 0) {
          customersQ = customersQ.in("id", customer_ids);
        } else if (filter) {
          if (filter.status) customersQ = customersQ.eq("status", filter.status);
          if (filter.tags && filter.tags.length > 0) {
            customersQ = customersQ.overlaps("tags", filter.tags);
          }
        }
        const { data: targets, error: tErr } = await customersQ.limit(1000);
        if (tErr) {
          return jsonResponse(request, { ok: false, error: tErr.message }, { status: 500 });
        }
        if (!targets || targets.length === 0) {
          return jsonResponse(
            request,
            { ok: false, error: "Nenhum assinante encontrado para os critérios" },
            { status: 400 },
          );
        }

        // Cria a campanha
        const { data: campaign, error: cErr } = await supabaseAdmin
          .from("campaigns")
          .insert({
            barbershop_id: barbershopId,
            name,
            status: "running",
            pace_seconds: pace_seconds ?? 30,
            audience_filter: filter ? filter : { customer_ids: customer_ids ?? [] },
          })
          .select("id, name, status, pace_seconds, created_at")
          .single();
        if (cErr || !campaign) {
          return jsonResponse(
            request,
            { ok: false, error: cErr?.message ?? "Falha ao criar campanha" },
            { status: 500 },
          );
        }

        // Enfileira jobs com scheduled_for escalonado (pace * i) e TTL 48h.
        const now = Date.now();
        const pace = (campaign.pace_seconds ?? 30) * 1000;
        const expiresAt = new Date(now + TTL_HOURS * 3600 * 1000).toISOString();
        const jobs = targets.map((t, i) => ({
          barbershop_id: barbershopId,
          campaign_id: campaign.id,
          customer_id: t.id,
          phone: t.phone,
          rendered_body: message,
          status: "pending" as const,
          scheduled_for: new Date(now + i * pace).toISOString(),
          expires_at: expiresAt,
        }));

        const { error: jErr, count } = await supabaseAdmin
          .from("message_jobs")
          .insert(jobs, { count: "exact" });
        if (jErr) {
          return jsonResponse(
            request,
            { ok: false, error: jErr.message, campaign },
            { status: 500 },
          );
        }

        // targets vira campaign_targets também (histórico)
        await supabaseAdmin.from("campaign_targets").insert(
          targets.map((t) => ({
            barbershop_id: barbershopId,
            campaign_id: campaign.id,
            customer_id: t.id,
            status: "pending",
          })),
        );

        return jsonResponse(
          request,
          { ok: true, campaign, jobs_created: count ?? jobs.length },
          { status: 201 },
        );
      },

      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const { data, error } = await supabaseAdmin
          .from("campaigns")
          .select("id, name, status, pace_seconds, created_at")
          .eq("barbershop_id", auth.token.barbershop_id)
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }

        // conta jobs por campanha (simples, sem group by nativo)
        const ids = (data ?? []).map((c) => c.id);
        const stats: Record<string, { pending: number; sent: number; failed: number }> = {};
        if (ids.length > 0) {
          const { data: js } = await supabaseAdmin
            .from("message_jobs")
            .select("campaign_id, status")
            .eq("barbershop_id", auth.token.barbershop_id)
            .in("campaign_id", ids);
          for (const j of js ?? []) {
            if (!j.campaign_id) continue;
            const s = (stats[j.campaign_id] ??= { pending: 0, sent: 0, failed: 0 });
            if (j.status === "pending" || j.status === "in_flight") s.pending += 1;
            else if (j.status === "sent") s.sent += 1;
            else if (j.status === "failed" || j.status === "expired") s.failed += 1;
          }
        }

        return jsonResponse(request, {
          ok: true,
          campaigns: (data ?? []).map((c) => ({
            ...c,
            stats: stats[c.id] ?? { pending: 0, sent: 0, failed: 0 },
          })),
        });
      },
    },
  },
});
