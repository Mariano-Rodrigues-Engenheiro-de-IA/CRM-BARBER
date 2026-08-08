// POST /api/public/ai/move-lead -> move (ou cria) um card na etapa de um
// funil, pelo telefone do lead. Pensado para um agente de IA mover leads
// pelo kanban durante uma conversa. Autenticação: Bearer token (mesmo
// token usado pela extensão).
//
// Body: { phone: string, funnel: string, stage: string, name?: string }
// `funnel` e `stage` aceitam tanto o nome exato (como aparece no CRM,
// sem diferenciar maiúsculas/minúsculas) quanto o UUID.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { moveLeadToStage, resolveFunnelAndStage } from "@/lib/funnel-move.server";

const bodySchema = z.object({
  phone: z.string().min(8).max(20),
  funnel: z.string().min(1),
  stage: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
});

export const Route = createFileRoute("/api/public/ai/move-lead")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const shop = auth.token.barbershop_id;

        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return jsonResponse(request, { ok: false, error: "JSON inválido" }, { status: 400 });
        }
        const parsed = bodySchema.safeParse(payload);
        if (!parsed.success) {
          return jsonResponse(
            request,
            { ok: false, error: "Dados inválidos", details: parsed.error.flatten() },
            { status: 400 },
          );
        }
        const { phone, funnel, stage, name } = parsed.data;

        const resolved = await resolveFunnelAndStage(supabaseAdmin, shop, funnel, stage);
        if (!resolved.ok) {
          return jsonResponse(request, { ok: false, error: resolved.error }, { status: 404 });
        }

        const digits = phone.replace(/\D/g, "");
        let customerId: string | null = null;
        let title = name || phone;
        if (!name) {
          const { data: customer } = await supabaseAdmin
            .from("customers")
            .select("id, name")
            .eq("barbershop_id", shop)
            .eq("phone", digits)
            .maybeSingle();
          customerId = customer?.id ?? null;
          title = customer?.name || phone;
        } else {
          const { data: customer } = await supabaseAdmin
            .from("customers")
            .select("id")
            .eq("barbershop_id", shop)
            .eq("phone", digits)
            .maybeSingle();
          customerId = customer?.id ?? null;
        }

        const result = await moveLeadToStage(supabaseAdmin, shop, {
          phone,
          funnelId: resolved.funnelId,
          stageId: resolved.stageId,
          title,
          customerId,
        });

        if (!result.ok) {
          return jsonResponse(request, { ok: false, error: result.error }, { status: 500 });
        }
        return jsonResponse(request, {
          ok: true,
          action: result.action,
          card_id: result.card_id,
          funnel_id: resolved.funnelId,
          stage_id: resolved.stageId,
        });
      },
    },
  },
});
