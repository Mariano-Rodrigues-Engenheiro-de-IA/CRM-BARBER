// GET /api/public/extension/campaigns/catalog -> catálogo global
// (ativo) + campanhas salvas/adotadas dessa barbearia (calendário +
// "minhas campanhas" da aba Campanhas).
// POST -> adota uma campanha do catálogo (ou cria do zero), salva como
// saved_campaigns dessa barbearia — pronta pra usar no disparo
// (API não-oficial) ou como rascunho a enviar pra aprovação (oficial).

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

export const Route = createFileRoute("/api/public/extension/campaigns/catalog")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }

        const [catalogRes, savedRes, calendarRes] = await Promise.all([
          supabaseAdmin
            .from("campaign_catalog")
            .select(
              "id, title, month, theme, idea_summary, suggested_copy, cover_image_url, message_image_url, sort_order",
            )
            .eq("active", true)
            .order("month", { ascending: true, nullsFirst: false })
            .order("sort_order", { ascending: true }),
          supabaseAdmin
            .from("saved_campaigns")
            .select(
              "id, catalog_campaign_id, title, body_text, image_path, status, rejection_reason, whatsapp_template_name, created_at",
            )
            .eq("barbershop_id", auth.token.barbershop_id)
            .order("created_at", { ascending: false }),
          supabaseAdmin
            .from("campaign_calendar_config")
            .select("unlocked_through_month")
            .eq("id", true)
            .maybeSingle(),
        ]);
        if (catalogRes.error) {
          return jsonResponse(
            request,
            { ok: false, error: catalogRes.error.message },
            { status: 500 },
          );
        }
        if (savedRes.error) {
          return jsonResponse(
            request,
            { ok: false, error: savedRes.error.message },
            { status: 500 },
          );
        }

        const saved = savedRes.data ?? [];
        const pending = saved.filter(
          (s) => s.status === "pending_approval" && s.whatsapp_template_name,
        );
        if (pending.length > 0) {
          const { data: instance } = await supabaseAdmin
            .from("whatsapp_instances")
            .select("waba_id, meta_access_token")
            .eq("barbershop_id", auth.token.barbershop_id)
            .maybeSingle();
          if (instance?.waba_id && instance?.meta_access_token) {
            const { getWhatsAppProviderByName } = await import("@/lib/whatsapp/provider.server");
            const provider = getWhatsAppProviderByName("meta");
            if (provider.listTemplates) {
              const result = await provider.listTemplates({
                instance_token: instance.meta_access_token,
                waba_id: instance.waba_id,
              });
              if (result.ok) {
                const byName = new Map(result.templates.map((t) => [t.name, t]));
                for (const s of pending) {
                  const meta = byName.get(s.whatsapp_template_name!);
                  if (!meta) continue;
                  let newStatus: "approved" | "rejected" | null = null;
                  if (meta.status === "APPROVED") newStatus = "approved";
                  else if (meta.status === "REJECTED") newStatus = "rejected";
                  if (newStatus) {
                    await supabaseAdmin
                      .from("saved_campaigns")
                      .update({
                        status: newStatus,
                        rejection_reason: meta.rejected_reason ?? null,
                        updated_at: new Date().toISOString(),
                      })
                      .eq("id", s.id);
                    s.status = newStatus;
                    s.rejection_reason = meta.rejected_reason ?? null;
                  }
                }
              }
            }
          }
        }
        return jsonResponse(request, {
          ok: true,
          catalog: catalogRes.data ?? [],
          saved,
          unlocked_through_month: calendarRes.data?.unlocked_through_month ?? 12,
        });
      },

      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }

        let body: Record<string, unknown>;
        try {
          body = await request.json();
        } catch {
          return jsonResponse(request, { ok: false, error: "JSON inválido." }, { status: 400 });
        }

        const title = typeof body.title === "string" ? body.title.trim() : "";
        const bodyText = typeof body.body_text === "string" ? body.body_text.trim() : "";
        const catalogCampaignId =
          typeof body.catalog_campaign_id === "string" && body.catalog_campaign_id
            ? body.catalog_campaign_id
            : null;
        const imagePath =
          typeof body.image_path === "string" && body.image_path ? body.image_path : null;

        if (!title || !bodyText) {
          return jsonResponse(
            request,
            { ok: false, error: "Campos obrigatórios: title, body_text." },
            { status: 400 },
          );
        }

        // Não-oficial: fica pronta pra disparar na hora. Oficial: quem
        // decide se vai pra 'pending_approval' é o endpoint dedicado de
        // envio (fase seguinte) — aqui sempre nasce como 'draft'.
        const { data: instance } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("provider, status")
          .eq("barbershop_id", auth.token.barbershop_id)
          .maybeSingle();
        const isMeta = instance?.provider === "meta" && instance?.status === "connected";

        const { data: created, error } = await supabaseAdmin
          .from("saved_campaigns")
          .insert({
            barbershop_id: auth.token.barbershop_id,
            catalog_campaign_id: catalogCampaignId,
            title,
            body_text: bodyText,
            image_path: imagePath,
            status: isMeta ? "draft" : "approved",
          })
          .select(
            "id, catalog_campaign_id, title, body_text, image_path, status, rejection_reason, whatsapp_template_name, created_at",
          )
          .single();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, campaign: created });
      },
    },
  },
});
