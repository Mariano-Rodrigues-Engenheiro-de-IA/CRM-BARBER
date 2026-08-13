// GET    /api/public/extension/campaigns/:id -> detalhe da campanha + lista
//        de jobs individuais (nome, telefone, status) — usado pela tela de
//        progresso de envio, pra listar quem já recebeu / falhou / ainda
//        está pendente, em vez de só a barra de porcentagem.
// PATCH  /api/public/extension/campaigns/:id -> status: running|paused|canceled
// DELETE /api/public/extension/campaigns/:id -> apaga campanha + jobs + targets
// Enquanto 'paused', /jobs/next não devolve jobs desta campanha.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const patchSchema = z.object({
  status: z.enum(["running", "paused", "canceled"]),
});

export const Route = createFileRoute("/api/public/extension/campaigns/$id")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      GET: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const { data: campaign, error: campErr } = await supabaseAdmin
          .from("campaigns")
          .select("id, name, status, created_at")
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id)
          .maybeSingle();
        if (campErr) {
          return jsonResponse(request, { ok: false, error: campErr.message }, { status: 500 });
        }
        if (!campaign) {
          return jsonResponse(request, { ok: false, error: "Not found" }, { status: 404 });
        }

        const { data: jobs, error: jobsErr } = await supabaseAdmin
          .from("message_jobs")
          .select("id, phone, status, last_error, customer_id, created_at")
          .eq("campaign_id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id)
          .order("created_at", { ascending: true });
        if (jobsErr) {
          return jsonResponse(request, { ok: false, error: jobsErr.message }, { status: 500 });
        }

        // Busca os nomes dos clientes num segundo passo (evita depender de
        // FK/join automático, que pode não estar configurado na tabela).
        const customerIds = Array.from(new Set((jobs ?? []).map((j) => j.customer_id).filter(Boolean)));
        const namesByCustomerId = new Map<string, string>();
        if (customerIds.length > 0) {
          const { data: customers } = await supabaseAdmin
            .from("customers")
            .select("id, name")
            .in("id", customerIds);
          for (const c of customers ?? []) namesByCustomerId.set(c.id, c.name || "");
        }

        const jobRows = (jobs ?? []).map((j) => ({
          id: j.id,
          name: (j.customer_id && namesByCustomerId.get(j.customer_id)) || null,
          phone: j.phone,
          status: j.status,
          error: j.last_error || null,
        }));

        const stats = {
          total: jobRows.length,
          sent: jobRows.filter((j) => j.status === "sent").length,
          failed: jobRows.filter((j) => j.status === "failed").length,
          pending: jobRows.filter((j) => j.status === "pending" || j.status === "in_flight").length,
        };

        return jsonResponse(request, { ok: true, campaign, stats, jobs: jobRows });
      },

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
        const { data, error } = await supabaseAdmin
          .from("campaigns")
          .update({ status: parsed.data.status })
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id)
          .select("id, name, status")
          .maybeSingle();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        if (!data) {
          return jsonResponse(request, { ok: false, error: "Not found" }, { status: 404 });
        }
        return jsonResponse(request, { ok: true, campaign: data });
      },

      DELETE: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        // Confirma tenant antes de apagar
        const { data: found } = await supabaseAdmin
          .from("campaigns")
          .select("id")
          .eq("id", params.id)
          .eq("barbershop_id", auth.token.barbershop_id)
          .maybeSingle();
        if (!found) {
          return jsonResponse(request, { ok: false, error: "Not found" }, { status: 404 });
        }
        await supabaseAdmin.from("message_jobs").delete()
          .eq("campaign_id", params.id).eq("barbershop_id", auth.token.barbershop_id);
        await supabaseAdmin.from("campaign_targets").delete()
          .eq("campaign_id", params.id).eq("barbershop_id", auth.token.barbershop_id);
        const { error } = await supabaseAdmin.from("campaigns").delete()
          .eq("id", params.id).eq("barbershop_id", auth.token.barbershop_id);
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true });
      },
    },
  },
});
