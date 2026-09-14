import { createServerFn } from "@tanstack/react-start";

export const adminListSubscriptions = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { listSubscriptions } = await import("./admin-billing.server");
  return listSubscriptions(supabaseAdmin);
});
