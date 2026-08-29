// Server function da tela admin de logs de webhook — visibilidade de
// plataforma sobre o que a Meta está de fato mandando pro nosso endpoint.

import { createServerFn } from "@tanstack/react-start";

export const adminListWebhookLogs = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("webhook_logs")
    .select("id, source, method, kind, status_code, headers, body, note, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return data ?? [];
});
