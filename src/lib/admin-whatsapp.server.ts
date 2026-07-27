// Lógica da configuração manual do WhatsApp oficial (uso admin).
//
// Não passa pelo Embedded Signup: o admin cria tudo no Meta for Developers e
// cola `phone_number_id` + `access_token` por barbearia. Aqui só persistimos
// em `whatsapp_instances` (provider "meta") e testamos as credenciais.

import { z } from "zod";
import type { SendResult, StatusResult } from "./whatsapp/types";

export const saveSchema = z.object({
  barbershop_id: z.string().uuid(),
  phone_number_id: z.string().trim().min(5).max(64).regex(/^\d+$/, "phone_number_id deve ser numérico"),
  access_token: z.string().trim().min(20).max(1000),
  waba_id: z.string().trim().max(64).optional().or(z.literal("")),
});

export const testSchema = z.object({
  barbershop_id: z.string().uuid(),
  /** Se informado, manda uma mensagem real de teste pra esse número. */
  test_phone: z.string().trim().max(20).optional().or(z.literal("")),
});

export const registerSchema = z.object({
  barbershop_id: z.string().uuid(),
  /** PIN de 6 dígitos definido no registro (guarde: é pedido em migrações). */
  pin: z.string().trim().regex(/^\d{6}$/, "O PIN deve ter exatamente 6 dígitos"),
});

export const providerSchema = z.object({
  barbershop_id: z.string().uuid(),
  provider: z.enum(["uazapi", "meta"]),
});

export type AdminShopRow = {
  barbershop_id: string;
  name: string;
  provider: string | null;
  status: string | null;
  phone: string | null;
  phone_number_id: string | null;
  waba_id: string | null;
  /** Nunca devolvemos o token — só se existe e os últimos 4 caracteres. */
  token_hint: string | null;
  last_synced_at: string | null;
};

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export async function listShops(supabaseAdmin: Admin): Promise<AdminShopRow[]> {
  const { data: shops, error } = await supabaseAdmin
    .from("barbershops")
    .select("id, name")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const { data: instances } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("barbershop_id, provider, status, phone, phone_number_id, waba_id, meta_access_token, last_synced_at");

  const byShop = new Map((instances ?? []).map((i) => [i.barbershop_id, i]));

  return (shops ?? []).map((s) => {
    const i = byShop.get(s.id);
    const token = i?.meta_access_token ?? null;
    return {
      barbershop_id: s.id,
      name: s.name,
      provider: i?.provider ?? null,
      status: i?.status ?? null,
      phone: i?.phone ?? null,
      phone_number_id: i?.phone_number_id ?? null,
      waba_id: i?.waba_id ?? null,
      token_hint: token ? `••••${token.slice(-4)}` : null,
      last_synced_at: i?.last_synced_at ?? null,
    };
  });
}

export async function saveCredentials(
  supabaseAdmin: Admin,
  input: z.infer<typeof saveSchema>,
): Promise<{ ok: true }> {
  const payload = {
    barbershop_id: input.barbershop_id,
    provider: "meta",
    phone_number_id: input.phone_number_id,
    meta_access_token: input.access_token,
    waba_id: input.waba_id ? input.waba_id : null,
    // O dispatcher lê instance_id/instance_token — mantemos espelhado.
    instance_id: input.phone_number_id,
    instance_token: input.access_token,
    status: "connecting",
    last_qr: null,
    last_synced_at: new Date().toISOString(),
  };

  const { data: existing } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id")
    .eq("barbershop_id", input.barbershop_id)
    .maybeSingle();

  const { error } = existing
    ? await supabaseAdmin.from("whatsapp_instances").update(payload).eq("id", existing.id)
    : await supabaseAdmin.from("whatsapp_instances").insert(payload);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function setProviderMode(
  supabaseAdmin: Admin,
  input: z.infer<typeof providerSchema>,
): Promise<{ ok: true }> {
  const { data: existing } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, phone_number_id, meta_access_token")
    .eq("barbershop_id", input.barbershop_id)
    .maybeSingle();

  const now = new Date().toISOString();
  const payload = input.provider === "meta"
    ? {
        barbershop_id: input.barbershop_id,
        provider: "meta",
        instance_id: existing?.phone_number_id ?? null,
        instance_token: existing?.meta_access_token ?? null,
        status: existing?.phone_number_id && existing?.meta_access_token ? "connecting" : "disconnected",
        phone: null,
        last_qr: null,
        last_synced_at: now,
      }
    : {
        barbershop_id: input.barbershop_id,
        provider: "uazapi",
        instance_id: null,
        instance_token: null,
        status: "disconnected",
        phone: null,
        last_qr: null,
        last_synced_at: now,
      };

  const { error } = existing
    ? await supabaseAdmin.from("whatsapp_instances").update(payload).eq("id", existing.id)
    : await supabaseAdmin.from("whatsapp_instances").insert(payload);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export type TestResult = {
  ok: boolean;
  status: StatusResult["status"] | "unknown";
  phone: string | null;
  message: string;
  send?: SendResult;
};

const smbRegisterUnavailablePattern = /Register endpoint is not available for SMB businesses/i;

function isSmbRegisterUnavailable(error: string | undefined): boolean {
  return !!error && smbRegisterUnavailablePattern.test(error);
}

function manualRegistrationMessage(): string {
  return "A Meta não permite registrar esse número pelo endpoint /register para contas SMB. Não é erro do CRM nem do PIN: conclua o registro manualmente no Meta for Developers/WhatsApp Manager, confirme o número e a verificação em duas etapas, depois volte e teste o envio novamente.";
}

/** Registra o número na Cloud API — resolve o erro 133010 no primeiro envio. */
export async function registerNumber(
  supabaseAdmin: Admin,
  input: z.infer<typeof registerSchema>,
): Promise<{ ok: boolean; message: string }> {
  const { data: inst } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, phone_number_id, meta_access_token")
    .eq("barbershop_id", input.barbershop_id)
    .maybeSingle();

  if (!inst?.phone_number_id || !inst.meta_access_token) {
    return { ok: false, message: "Salve phone_number_id e access_token antes de registrar." };
  }

  const { getBspAdapter } = await import("./whatsapp/bsp/index.server");
  const bsp = getBspAdapter();
  if (!bsp.register) {
    return { ok: false, message: "Este provedor não expõe registro manual do número." };
  }

  const res = await bsp.register({
    access_token: inst.meta_access_token,
    phone_number_id: inst.phone_number_id,
    pin: input.pin,
  });

  if (!res.ok) {
    if (isSmbRegisterUnavailable(res.error)) {
      return { ok: false, message: manualRegistrationMessage() };
    }
    return { ok: false, message: `Falha ao registrar: ${res.error ?? "erro desconhecido"}` };
  }

  await supabaseAdmin
    .from("whatsapp_instances")
    .update({ status: "connected", last_synced_at: new Date().toISOString() })
    .eq("id", inst.id);

  return { ok: true, message: "Número registrado na Cloud API. Teste o envio agora." };
}

export async function testCredentials(
  supabaseAdmin: Admin,
  input: z.infer<typeof testSchema>,
): Promise<TestResult> {
  const { data: inst } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, phone_number_id, meta_access_token")
    .eq("barbershop_id", input.barbershop_id)
    .maybeSingle();

  if (!inst?.phone_number_id || !inst.meta_access_token) {
    return { ok: false, status: "unknown", phone: null, message: "Salve phone_number_id e access_token antes de testar." };
  }

  const { getBspAdapter } = await import("./whatsapp/bsp/index.server");
  const bsp = getBspAdapter();
  const s = await bsp.status({
    access_token: inst.meta_access_token,
    phone_number_id: inst.phone_number_id,
  });

  let send: SendResult | undefined;
  const to = (input.test_phone ?? "").replace(/\D/g, "");
  if (s.status === "connected" && to.length >= 10) {
    send = await bsp.sendText({
      access_token: inst.meta_access_token,
      phone_number_id: inst.phone_number_id,
      to,
      text: "Teste de conexão do CRM. Se você recebeu esta mensagem, está tudo certo.",
    });
  }

  await supabaseAdmin
    .from("whatsapp_instances")
    .update({
      status: s.status,
      phone: s.phone ?? null,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", inst.id);

  const notRegistered = !!send && !send.ok && /133010|not registered/i.test(send.error ?? "");

  const message =
    s.status === "connected"
      ? send
        ? send.ok
          ? "Credenciais válidas e mensagem de teste enviada."
          : notRegistered
            ? `Credenciais válidas, mas o número ainda não está registrado na Cloud API (${send.error}). Se o registro por PIN retornar “Register endpoint is not available for SMB businesses”, finalize esse registro manualmente no Meta for Developers/WhatsApp Manager e teste de novo.`
            : `Credenciais válidas, mas o envio falhou: ${send.error}`
        : "Credenciais válidas — número ativo na Cloud API."
      : s.status === "disconnected"
        ? "Token inválido ou sem permissão nesse phone_number_id (401/403)."
        : "Não foi possível confirmar agora — a Meta respondeu com erro temporário.";

  return { ok: s.status === "connected" && (!send || send.ok), status: s.status, phone: s.phone ?? null, message, send };
}
