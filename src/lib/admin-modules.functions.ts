// Server functions da tela admin de Módulos de Treinamento — mesmo
// padrão de auth das outras telas admin (atrás da autenticação do site).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type ModuleRow = {
  id: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  sort_order: number;
  active: boolean;
};

export const adminListModules = createServerFn({ method: "GET" }).handler(async (): Promise<ModuleRow[]> => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("training_modules")
    .select("id, title, description, cover_image_url, sort_order, active")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
});

const moduleInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).optional(),
  cover_image_url: z.string().trim().url().max(500).optional(),
  sort_order: z.number().int().optional(),
});

export const adminCreateModule = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => moduleInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin
      .from("training_modules")
      .insert(data)
      .select("id, title, description, cover_image_url, sort_order, active")
      .single();
    if (error) throw new Error(error.message);
    return created;
  });

const moduleUpdateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  cover_image_url: z.string().trim().url().max(500).optional().nullable(),
  sort_order: z.number().int().optional(),
  active: z.boolean().optional(),
});

export const adminUpdateModule = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => moduleUpdateSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, ...patch } = data;
    const { data: updated, error } = await supabaseAdmin
      .from("training_modules")
      .update(patch)
      .eq("id", id)
      .select("id, title, description, cover_image_url, sort_order, active")
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });

export const adminDeleteModule = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("training_modules").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Upload da capa — recebe o arquivo em base64 (data URL), sobe pro
// Storage via service_role (mesmo padrão de auth do resto do admin, sem
// depender de sessão Supabase Auth no navegador), devolve a URL pública.
const uploadCoverSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(1).max(100),
  base64: z.string().min(1),
});

export const adminUploadModuleCover = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => uploadCoverSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const bytes = Buffer.from(data.base64, "base64");
    const path = `${Date.now()}-${data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error } = await supabaseAdmin.storage.from("training-covers").upload(path, bytes, {
      contentType: data.contentType,
      upsert: false,
    });
    if (error) throw new Error(error.message);
    const { data: pub } = supabaseAdmin.storage.from("training-covers").getPublicUrl(path);
    return { url: pub.publicUrl };
  });
