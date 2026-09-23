// POST /api/public/extension/mark-attendance -> marca um atendimento
// pro cliente, adicionando/reentrando ele no funil especial "Pós-venda"
// (auto-criado, 1 por barbearia, mesmo padrão de "Listas").
//
// Cada clique é um evento NOVO — mesmo que o cliente já estivesse
// nessa etapa de um atendimento anterior, o tempo é sempre resetado
// (usa recordReentry, não recordStageChange, que só reseta em mudança
// de etapa de verdade) e o histórico de follow-up já enviado é limpo,
// pra pós-venda/retorno dispararem de novo do zero a partir de agora.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";
import { recordReentry, recordStageChange } from "@/lib/funnel-stage-history.server";
import { ensureCustomerId } from "@/lib/customer-linking.server";
import { ensurePostsaleFunnel } from "@/lib/postsale-funnel.server";

const bodySchema = z.object({
  phone: z.string().trim().min(1),
  title: z.string().trim().max(200).nullable().optional(),
  wa_contact_id: z.string().uuid().nullable().optional(),
});

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 13 ? digits : null;
}

export const Route = createFileRoute("/api/public/extension/mark-attendance")({
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
            { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
            { status: 400 },
          );
        }
        const shop = auth.token.barbershop_id;
        const normalizedPhone = normalizePhone(parsed.data.phone);
        if (!normalizedPhone) {
          return jsonResponse(request, { ok: false, error: "Telefone inválido." }, { status: 400 });
        }

        const { getBillingStatus, postSaleDailyBlock } = await import("@/lib/billing.server");
        const billing = await getBillingStatus(supabaseAdmin, shop);
        const blocked = postSaleDailyBlock(billing);
        if (blocked) {
          return jsonResponse(request, { ok: false, error: blocked }, { status: 402 });
        }

        // Garante o funil especial "Pós-venda" + etapa fixa "Atendidos"
        // — normalmente já existe (a tela de configuração cria
        // proativamente ao abrir), mas garante de novo aqui por
        // segurança caso alguém marque atendimento sem nunca ter
        // aberto a aba de configuração antes.
        const ensured = await ensurePostsaleFunnel(supabaseAdmin, shop);
        if ("error" in ensured) {
          return jsonResponse(request, { ok: false, error: ensured.error }, { status: 500 });
        }
        const { funnel, stage } = ensured;

        // Já existe um card desse cliente nesse funil? (mesmo telefone,
        // ou mesmo wa_contact_id se disponível)
        let existingQuery = supabaseAdmin
          .from("funnel_cards")
          .select("id, title, phone, customer_id")
          .eq("barbershop_id", shop)
          .eq("funnel_id", funnel.id);
        existingQuery = parsed.data.wa_contact_id
          ? existingQuery.eq("wa_contact_id", parsed.data.wa_contact_id)
          : existingQuery.eq("phone", normalizedPhone);
        const { data: existing } = await existingQuery.maybeSingle();

        const now = new Date().toISOString();
        let cardId: string;

        if (existing) {
          cardId = existing.id;
          await supabaseAdmin
            .from("funnel_cards")
            .update({ stage_id: stage.id, stage_entered_at: now })
            .eq("id", cardId);
          // Sequência de pós-venda/retorno já enviada antes não vale mais
          // — esse é um atendimento NOVO, a sequência recomeça do zero.
          await supabaseAdmin.from("funnel_followup_sent_log").delete().eq("card_id", cardId);
          await recordReentry(supabaseAdmin, { cardId, funnelId: funnel.id, stageId: stage.id });
          // Vincula (ou cria) um cliente de verdade — fonte de nome
          // melhor que o telefone cru, usada pela lista de atendimentos.
          await ensureCustomerId(supabaseAdmin, shop, {
            id: cardId,
            title: parsed.data.title || existing.title,
            phone: normalizedPhone,
            customer_id: existing.customer_id,
          });
        } else {
          const { data: created, error: createErr } = await supabaseAdmin
            .from("funnel_cards")
            .insert({
              barbershop_id: shop,
              funnel_id: funnel.id,
              stage_id: stage.id,
              title: parsed.data.title || normalizedPhone,
              phone: normalizedPhone,
              wa_contact_id: parsed.data.wa_contact_id ?? null,
              stage_entered_at: now,
            })
            .select("id")
            .single();
          if (createErr || !created) {
            return jsonResponse(
              request,
              { ok: false, error: createErr?.message ?? "Falha ao marcar atendimento" },
              { status: 500 },
            );
          }
          cardId = created.id;
          await recordStageChange(supabaseAdmin, {
            cardId,
            funnelId: funnel.id,
            fromStageId: null,
            toStageId: stage.id,
          });
          await ensureCustomerId(supabaseAdmin, shop, {
            id: cardId,
            title: parsed.data.title || normalizedPhone,
            phone: normalizedPhone,
            customer_id: null,
          });
        }

        return jsonResponse(request, { ok: true, card_id: cardId });
      },
    },
  },
});
