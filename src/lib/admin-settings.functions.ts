// Server functions da configuração de "número emissor" da Zaylo
// (mensagens administrativas, boas-vindas pos-compra) - mesmo padrão de
// auth das outras telas admin (atrás da autenticação do site).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const adminGetSenderSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { getSenderBarbershopId } = await import("@/lib/admin-whatsapp.server");
  const senderBarbershopId = await getSenderBarbershopId(supabaseAdmin);

  let senderBarbershopName: string | null = null;
  let senderConnected = false;
  if (senderBarbershopId) {
    const [{ data: shop }, { data: instance }] = await Promise.all([
      supabaseAdmin.from("barbershops").select("name").eq("id", senderBarbershopId).maybeSingle(),
      supabaseAdmin
        .from("whatsapp_instances")
        .select("status")
        .eq("barbershop_id", senderBarbershopId)
        .maybeSingle(),
    ]);
    senderBarbershopName = shop?.name ?? null;
    senderConnected = instance?.status === "connected";
  }

  const { data: shops } = await supabaseAdmin
    .from("barbershops")
    .select("id, name")
    .order("name", { ascending: true });

  return {
    senderBarbershopId,
    senderBarbershopName,
    senderConnected,
    allShops: shops ?? [],
  };
});

export const adminSetSenderBarbershop = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ barbershop_id: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { setSenderBarbershopId } = await import("@/lib/admin-whatsapp.server");
    return setSenderBarbershopId(supabaseAdmin, { barbershop_id: data.barbershop_id });
  });
