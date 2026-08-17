// Server functions da tela admin de Aulas (academy) — conteúdo global de
// treinamento, mesmo padrão de auth das outras telas admin (atrás da
// autenticação do site).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type LessonRow = {
  id: string;
  title: string;
  youtube_url: string;
  description: string | null;
  featured: boolean;
  sort_order: number;
  active: boolean;
};

export const adminListLessons = createServerFn({ method: "GET" }).handler(async (): Promise<LessonRow[]> => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("lessons")
    .select("id, title, youtube_url, description, featured, sort_order, active")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
});

const lessonInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  youtube_url: z.string().trim().url().max(400),
  description: z.string().trim().max(1000).optional(),
  featured: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

export const adminCreateLesson = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => lessonInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Só uma aula em destaque por vez — se essa vier marcada, desmarca as outras.
    if (data.featured) {
      await supabaseAdmin.from("lessons").update({ featured: false }).eq("featured", true);
    }
    const { data: created, error } = await supabaseAdmin
      .from("lessons")
      .insert(data)
      .select("id, title, youtube_url, description, featured, sort_order, active")
      .single();
    if (error) throw new Error(error.message);
    return created;
  });

const lessonUpdateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(160).optional(),
  youtube_url: z.string().trim().url().max(400).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  featured: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  active: z.boolean().optional(),
});

export const adminUpdateLesson = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => lessonUpdateSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, ...patch } = data;
    if (patch.featured) {
      await supabaseAdmin.from("lessons").update({ featured: false }).neq("id", id).eq("featured", true);
    }
    const { data: updated, error } = await supabaseAdmin
      .from("lessons")
      .update(patch)
      .eq("id", id)
      .select("id, title, youtube_url, description, featured, sort_order, active")
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });

export const adminDeleteLesson = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("lessons").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
