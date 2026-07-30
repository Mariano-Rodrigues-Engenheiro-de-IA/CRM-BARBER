// POST /api/public/extension/campaigns
// Cria uma campanha e enfileira message_jobs em uma única chamada.
//
// Body:
// {
//   name: string,
//   message?: string,                   // corpo único (legado)
//   message_variants?: string[],        // 1..3 variações (rotacionadas por job)
//   pace_seconds?: number,              // ritmo fixo (default 30)
//   pace_seconds_min?, pace_seconds_max?: number, // faixa aleatória
//   customer_ids?: string[],
//   filter?: { status?: string, tags?: string[] }
// }
//
// TTL de 48h aplicado em cada job. Tenant vem SEMPRE do token.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { CUSTOMER_STATUS_VALUES } from "@/lib/customer-presets";

const bodySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(4000).optional(),
    message_variants: z.array(z.string().trim().min(1).max(4000)).min(1).max(3).optional(),
    pace_seconds: z.number().int().min(5).max(600).optional(),
    pace_seconds_min: z.number().int().min(5).max(600).optional(),
    pace_seconds_max: z.number().int().min(5).max(600).optional(),
    customer_ids: z.array(z.string().uuid()).max(2000).optional(),
    // Disparo a partir dos funis: lista de telefones (contatos do Inbox,
    // etiquetas ou colunas do kanban). Vira/reaproveita customers.
    phone_targets: z
      .array(
        z.object({
          phone: z.string().trim().min(8).max(30),
          name: z.string().trim().max(160).optional(),
        }),
      )
      .max(2000)
      .optional(),
    scheduled_for: z.string().min(4).max(40).optional(),
    filter: z
      .object({
        status: z.enum(CUSTOMER_STATUS_VALUES).optional(),
        tags: z.array(z.string().min(1).max(40)).max(10).optional(),
      })
      .optional(),
  })
  .refine((v) => v.message || (v.message_variants && v.message_variants.length > 0), {
    message: "Informe message ou message_variants",
  })
  .refine(
    (v) =>
      (v.customer_ids && v.customer_ids.length > 0) ||
      (v.phone_targets && v.phone_targets.length > 0) ||
      v.filter,
    { message: "Informe customer_ids, phone_targets ou filter" },
  );


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
        const { name, message, message_variants, pace_seconds, pace_seconds_min, pace_seconds_max, customer_ids, filter, scheduled_for } = parsed.data;

        // Agendamento opcional: base do primeiro job. Datas no passado caem para agora.
        const scheduledBase = scheduled_for ? Date.parse(scheduled_for) : NaN;
        if (scheduled_for && Number.isNaN(scheduledBase)) {
          return jsonResponse(request, { ok: false, error: "Data de agendamento inválida" }, { status: 400 });
        }

        const variants = (message_variants && message_variants.length > 0)
          ? message_variants
          : [message as string];

        // Faixa de pace: se min/max informados, aleatório dentro da faixa.
        // Senão usa pace_seconds fixo (default 30).
        const paceMin = pace_seconds_min ?? pace_seconds ?? 30;
        const paceMax = pace_seconds_max ?? pace_seconds ?? paceMin;
        const paceLo = Math.min(paceMin, paceMax);
        const paceHi = Math.max(paceMin, paceMax);
        const nextDelayMs = () => (paceLo + Math.floor(Math.random() * (paceHi - paceLo + 1))) * 1000;

        // Resolve alvo → lista de customers {id, phone}
        let customersQ = supabaseAdmin
          .from("customers")
          .select("id, phone")
          .eq("barbershop_id", barbershopId)
          .is("archived_at", null);

        if (customer_ids && customer_ids.length > 0) {
          customersQ = customersQ.in("id", customer_ids);
        } else if (filter) {
          if (filter.status) customersQ = customersQ.eq("status", filter.status);
          if (filter.tags && filter.tags.length > 0) {
            customersQ = customersQ.overlaps("tags", filter.tags);
          }
        }
        const { data: allTargets, error: tErr } = await customersQ.limit(2000);
        if (tErr) {
          return jsonResponse(request, { ok: false, error: tErr.message }, { status: 500 });
        }
        // Planilhas sem coluna de telefone geram contatos com telefone placeholder
        // ("sem-tel-..."). Eles ficam no CRM, mas nunca entram na fila de disparo.
        const targets = (allTargets ?? []).filter((t) => /^\d{10,15}$/.test(String(t.phone ?? "")));
        if (targets.length === 0) {
          return jsonResponse(
            request,
            { ok: false, error: "Nenhum assinante encontrado para os critérios" },
            { status: 400 },
          );
        }

        const { getBillingStatus, limitBlock } = await import("@/lib/billing.server");
        const billing = await getBillingStatus(supabaseAdmin, barbershopId);
        const blockedMsg = limitBlock(billing, "messages", targets.length);
        if (blockedMsg) {
          return jsonResponse(
            request,
            { ok: false, error: blockedMsg, code: "limit_reached", billing },
            { status: 402 },
          );
        }

        const { data: campaign, error: cErr } = await supabaseAdmin
          .from("campaigns")
          .insert({
            barbershop_id: barbershopId,
            name,
            status: "running",
            pace_seconds: paceLo,
            pace_seconds_min: paceLo,
            pace_seconds_max: paceHi,
            message_variants: variants,
            audience_filter: filter ? filter : { customer_ids: customer_ids ?? [] },
          })
          .select("id, name, status, pace_seconds, pace_seconds_min, pace_seconds_max, created_at")
          .single();
        if (cErr || !campaign) {
          return jsonResponse(
            request,
            { ok: false, error: cErr?.message ?? "Falha ao criar campanha" },
            { status: 500 },
          );
        }

        const now = Math.max(Date.now(), Number.isNaN(scheduledBase) ? 0 : scheduledBase);
        const expiresAt = new Date(now + TTL_HOURS * 3600 * 1000).toISOString();
        let cursor = now;
        const jobs = targets.map((t, i) => {
          if (i > 0) cursor += nextDelayMs();
          const variant = variants[i % variants.length];
          return {
            barbershop_id: barbershopId,
            campaign_id: campaign.id,
            customer_id: t.id,
            phone: t.phone,
            rendered_body: variant,
            status: "pending" as const,
            scheduled_for: new Date(cursor).toISOString(),
            expires_at: expiresAt,
          };
        });

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
          .select("id, name, status, pace_seconds, pace_seconds_min, pace_seconds_max, message_variants, created_at")
          .eq("barbershop_id", auth.token.barbershop_id)
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }

        const ids = (data ?? []).map((c) => c.id);
        const stats: Record<string, { pending: number; sent: number; failed: number }> = {};
        const lastErrors: Record<string, string | null> = {};
        if (ids.length > 0) {
          const { data: js } = await supabaseAdmin
            .from("message_jobs")
            .select("campaign_id, status, last_error, updated_at")
            .eq("barbershop_id", auth.token.barbershop_id)
            .in("campaign_id", ids)
            .order("updated_at", { ascending: false });

          for (const j of js ?? []) {
            if (!j.campaign_id) continue;
            const s = (stats[j.campaign_id] ??= { pending: 0, sent: 0, failed: 0 });
            if (j.status === "pending" || j.status === "in_flight") s.pending += 1;
            else if (j.status === "sent") s.sent += 1;
            else if (j.status === "failed" || j.status === "expired") s.failed += 1;
            if ((j.status === "failed" || j.status === "expired") && j.last_error && !lastErrors[j.campaign_id]) {
              lastErrors[j.campaign_id] = j.last_error;
            }

          }
        }

        return jsonResponse(request, {
          ok: true,
          campaigns: (data ?? []).map((c) => ({
            ...c,
            stats: stats[c.id] ?? { pending: 0, sent: 0, failed: 0 },
            last_error: lastErrors[c.id] ?? null,
          })),
        });
      },
    },
  },
});

