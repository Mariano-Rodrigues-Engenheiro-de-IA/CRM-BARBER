// Server functions da configuração da página Agente de IA (hoje só o
// link do vídeo de vendas) — mesmo padrão de auth das outras telas admin.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const adminGetAgenteIaSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("agente_ia_settings")
    .select("sales_video_url")
    .eq("id", true)
    .single();
  if (error) throw new Error(error.message);
  return data;
});

export const adminSaveAgenteIaSettings = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ sales_video_url: z.string().trim().url().max(400).optional().or(z.literal("")) }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("agente_ia_settings")
      .update({ sales_video_url: data.sales_video_url || null, updated_at: new Date().toISOString() })
      .eq("id", true);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
