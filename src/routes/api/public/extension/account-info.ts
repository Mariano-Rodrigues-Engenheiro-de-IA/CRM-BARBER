// GET   /api/public/extension/account-info -> status da assinatura + dados de contato
// PATCH /api/public/extension/account-info -> edita o telefone de contato
//
// Usado pelo botão novo na extensão (dentro da conversa do WhatsApp) —
// deixa o dono da barbearia ver rapidamente se a assinatura está em dia
// e corrigir o telefone de contato, sem precisar entrar no site.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const patchSchema = z.object({
  owner_phone: z.string().trim().min(8).max(20),
});

export const Route = createFileRoute("/api/public/extension/account-info")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const shop = auth.token.barbershop_id;

        const { data: shopRow, error: shopErr } = await supabaseAdmin
          .from("barbershops")
          .select("name, owner_name, owner_email, owner_phone")
          .eq("id", shop)
          .maybeSingle();
        if (shopErr) return jsonResponse(request, { ok: false, error: shopErr.message }, { status: 500 });

        const { getBillingStatus } = await import("@/lib/billing.server");
        const billing = await getBillingStatus(supabaseAdmin, shop);

        // Só oferece "Gerenciar assinatura" quando existe um cliente de
        // verdade na Stripe por trás (id começando com "cus_") — cortesia
        // e assinaturas dadas manualmente não têm o que gerenciar lá.
        const { data: subRow } = await supabaseAdmin
          .from("shop_subscriptions")
          .select("stripe_customer_id")
          .eq("barbershop_id", shop)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const canManageBilling = !!subRow?.stripe_customer_id?.startsWith("cus_");

        return jsonResponse(request, {
          ok: true,
          account: {
            shop_name: shopRow?.name ?? null,
            owner_name: shopRow?.owner_name ?? null,
            owner_email: shopRow?.owner_email ?? null,
            owner_phone: shopRow?.owner_phone ?? null,
          },
          billing: {
            premium: billing.premium,
            status: billing.status,
            current_period_end: billing.current_period_end,
            can_manage: canManageBilling,
          },
        });
      },

      PATCH: async ({ request }) => {
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
            { ok: false, error: parsed.error.issues[0]?.message ?? "Telefone inválido" },
            { status: 400 },
          );
        }
        const { error } = await supabaseAdmin
          .from("barbershops")
          .update({ owner_phone: parsed.data.owner_phone })
          .eq("id", auth.token.barbershop_id);
        if (error) return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        return jsonResponse(request, { ok: true });
      },
    },
  },
});
