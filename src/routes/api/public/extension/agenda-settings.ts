// GET   /api/public/extension/agenda-settings -> busca config (cria padrão se não existir)
// PATCH /api/public/extension/agenda-settings -> atualiza slot_duration_minutes e/ou business_hours

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const dayHours = z.object({
  closed: z.boolean(),
  open: z.string().optional(),
  close: z.string().optional(),
});
/** Slug estável do link público, gerado a partir do nome da barbearia. */
function slugify(name: string, id: string) {
  const base = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${base || "barbearia"}-${id.slice(0, 6)}`;
}

async function ensureSlug(supabaseAdmin: any, settings: any) {
  if (settings?.public_slug) return settings;
  const { data: shop } = await supabaseAdmin.from("barbershops").select("name").eq("id", settings.barbershop_id).maybeSingle();
  const slug = slugify(shop?.name ?? "barbearia", settings.barbershop_id);
  const { data } = await supabaseAdmin
    .from("agenda_settings")
    .update({ public_slug: slug })
    .eq("barbershop_id", settings.barbershop_id)
    .select("barbershop_id, slot_duration_minutes, business_hours, online_booking_enabled, public_slug, hide_professional_selection, distribution_mode")
    .maybeSingle();
  return data ?? settings;
}

const patchSchema = z.object({
  slot_duration_minutes: z.number().int().min(10).max(120).optional(),
  business_hours: z.record(z.string(), dayHours).optional(),
  online_booking_enabled: z.boolean().optional(),
  hide_professional_selection: z.boolean().optional(),
  distribution_mode: z.enum(["random", "availability", "priority"]).optional(),
});

export const Route = createFileRoute("/api/public/extension/agenda-settings")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const { data: existing } = await supabaseAdmin
          .from("agenda_settings")
          .select("barbershop_id, slot_duration_minutes, business_hours, online_booking_enabled, public_slug, hide_professional_selection, distribution_mode")
          .eq("barbershop_id", auth.token.barbershop_id)
          .maybeSingle();
        if (existing) {
          return jsonResponse(request, { ok: true, settings: await ensureSlug(supabaseAdmin, existing) });
        }
        // Cria com os padrões da migration na primeira consulta.
        const { data: created, error } = await supabaseAdmin
          .from("agenda_settings")
          .insert({ barbershop_id: auth.token.barbershop_id })
          .select("barbershop_id, slot_duration_minutes, business_hours, online_booking_enabled, public_slug, hide_professional_selection, distribution_mode")
          .single();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, settings: await ensureSlug(supabaseAdmin, created) });
      },

      PATCH: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) {
          return jsonResponse(request, { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
        }
        const { data, error } = await supabaseAdmin
          .from("agenda_settings")
          .upsert({ barbershop_id: auth.token.barbershop_id, ...parsed.data }, { onConflict: "barbershop_id" })
          .select("barbershop_id, slot_duration_minutes, business_hours, online_booking_enabled, public_slug, hide_professional_selection, distribution_mode")
          .single();
        if (error) {
          return jsonResponse(request, { ok: false, error: error.message }, { status: 500 });
        }
        return jsonResponse(request, { ok: true, settings: await ensureSlug(supabaseAdmin, data) });
      },
    },
  },
});
