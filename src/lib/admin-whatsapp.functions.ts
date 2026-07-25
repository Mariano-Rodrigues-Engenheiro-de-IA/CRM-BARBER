// Server functions da tela admin de conexão manual do WhatsApp oficial.
// Rotas/funções fora de /api/public ficam atrás da autenticação do site.

import { createServerFn } from "@tanstack/react-start";
import { registerSchema, saveSchema, testSchema } from "./admin-whatsapp.server";

export const adminListShops = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { listShops } = await import("./admin-whatsapp.server");
  return listShops(supabaseAdmin);
});

export const adminSaveMetaCredentials = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => saveSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { saveCredentials } = await import("./admin-whatsapp.server");
    return saveCredentials(supabaseAdmin, data);
  });

export const adminTestMetaConnection = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => testSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { testCredentials } = await import("./admin-whatsapp.server");
    return testCredentials(supabaseAdmin, data);
  });
