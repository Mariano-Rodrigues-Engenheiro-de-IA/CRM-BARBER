// Server functions da tela admin de conexão manual do WhatsApp oficial.
// Rotas/funções fora de /api/public ficam atrás da autenticação do site.

import { createServerFn } from "@tanstack/react-start";
import {
  providerSchema,
  registerSchema,
  saveSchema,
  testSchema,
  claimPendingSchema,
  businessTypeSchema,
} from "./admin-whatsapp.server";

export const adminListShops = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { listShops } = await import("./admin-whatsapp.server");
  return listShops(supabaseAdmin);
});

export const adminListClientsOverview = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { listClientsOverview } = await import("./admin-whatsapp.server");
  return listClientsOverview(supabaseAdmin);
});

export const adminSetBusinessType = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => businessTypeSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { setBusinessType } = await import("./admin-whatsapp.server");
    return setBusinessType(supabaseAdmin, data);
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

export const adminRegisterMetaNumber = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => registerSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { registerNumber } = await import("./admin-whatsapp.server");
    return registerNumber(supabaseAdmin, data);
  });

export const adminSetWhatsAppProvider = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => providerSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { setProviderMode } = await import("./admin-whatsapp.server");
    return setProviderMode(supabaseAdmin, data);
  });

export const adminListPendingMetaConnections = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { listPendingMetaConnections } = await import("./admin-whatsapp.server");
  return listPendingMetaConnections(supabaseAdmin);
});

export const adminClaimPendingMetaConnection = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => claimPendingSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { claimPendingMetaConnection } = await import("./admin-whatsapp.server");
    return claimPendingMetaConnection(supabaseAdmin, data);
  });
