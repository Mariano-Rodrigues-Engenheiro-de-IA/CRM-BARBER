// Server functions da tela admin de Campanhas (catálogo do marketplace
// sazonal) — conteúdo global de campanhas prontas, mesmo padrão de auth
// das outras telas admin (atrás da autenticação do site). Ver
// admin-lessons.functions.ts para o mesmo padrão em Aulas.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type CampaignCatalogRow = {
  id: string;
  title: string;
  month: number | null;
  theme: string | null;
  idea_summary: string;
  suggested_copy: string;
  cover_image_url: string | null;
  sort_order: number;
  active: boolean;
};

const CAMPAIGN_COLUMNS =
  "id, title, month, theme, idea_summary, suggested_copy, cover_image_url, sort_order, active";

export const adminListCampaigns = createServerFn({ method: "GET" }).handler(
  async (): Promise<CampaignCatalogRow[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("campaign_catalog")
      .select(CAMPAIGN_COLUMNS)
      .order("month", { ascending: true, nullsFirst: false })
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  },
);

const campaignInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  month: z.number().int().min(1).max(12).nullable().optional(),
  theme: z.string().trim().max(80).optional(),
  idea_summary: z.string().trim().min(1).max(600),
  suggested_copy: z.string().trim().min(1).max(1200),
  cover_image_url: z.string().trim().url().max(500).optional(),
  sort_order: z.number().int().optional(),
});

export const adminCreateCampaign = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => campaignInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin
      .from("campaign_catalog")
      .insert(data)
      .select(CAMPAIGN_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return created;
  });

const campaignUpdateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(160).optional(),
  month: z.number().int().min(1).max(12).nullable().optional(),
  theme: z.string().trim().max(80).optional().nullable(),
  idea_summary: z.string().trim().min(1).max(600).optional(),
  suggested_copy: z.string().trim().min(1).max(1200).optional(),
  cover_image_url: z.string().trim().url().max(500).optional().nullable(),
  sort_order: z.number().int().optional(),
  active: z.boolean().optional(),
});

export const adminUpdateCampaign = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => campaignUpdateSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, ...patch } = data;
    const { data: updated, error } = await supabaseAdmin
      .from("campaign_catalog")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(CAMPAIGN_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });

export const adminDeleteCampaign = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("campaign_catalog").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
