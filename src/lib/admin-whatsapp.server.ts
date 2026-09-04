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

export const businessTypeSchema = z.object({
  barbershop_id: z.string().uuid(),
  business_type: z.enum(["barbearia", "odontologia"]),
});

export const claimPendingSchema = z.object({
  pending_id: z.string().uuid(),
  barbershop_id: z.string().uuid(),
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

/** Painel geral de clientes (visão do Mariano) — nome, contato, status de
 * conexão e se a instância é compartilhada com a IA. Mais abrangente que
 * AdminShopRow (que é focado só na config manual da Meta). */
export type AdminClientOverviewRow = {
  barbershop_id: string;
  name: string;
  owner_phone: string | null;
  owner_email: string | null;
  business_type: string;
  provider: string | null;
  status: string | null;
  connected_phone: string | null;
  shared_with_ai: boolean;
  customers_count: number;
  created_at: string | null;
};

export async function listClientsOverview(supabaseAdmin: Admin): Promise<AdminClientOverviewRow[]> {
  const { data: shops, error } = await supabaseAdmin
    .from("barbershops")
    .select("id, name, owner_phone, owner_email, business_type, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const { data: instances } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("barbershop_id, provider, status, phone, shared_with_ai");
  const byShop = new Map((instances ?? []).map((i) => [i.barbershop_id, i]));

  // Contagem de clientes cadastrados por barbearia — dá contexto de uso
  // real, não só status de conexão.
  const { data: customerRows } = await supabaseAdmin.from("customers").select("barbershop_id");
  const countsByShop = new Map<string, number>();
  for (const c of customerRows ?? []) {
    countsByShop.set(c.barbershop_id, (countsByShop.get(c.barbershop_id) ?? 0) + 1);
  }

  return (shops ?? []).map((s) => {
    const i = byShop.get(s.id);
    return {
      barbershop_id: s.id,
      name: s.name,
      owner_phone: s.owner_phone,
      owner_email: s.owner_email,
      business_type: s.business_type,
      provider: i?.provider ?? null,
      status: i?.status ?? null,
      connected_phone: i?.phone ?? null,
      shared_with_ai: i?.shared_with_ai ?? false,
      customers_count: countsByShop.get(s.id) ?? 0,
      created_at: s.created_at ?? null,
    };
  });
}

/** Só o admin decide o nicho de cada conta por enquanto — o cliente não
 * escolhe isso sozinho. Direto pelo painel de Clientes. */
export async function setBusinessType(
  supabaseAdmin: Admin,
  input: { barbershop_id: string; business_type: "barbearia" | "odontologia" },
): Promise<{ ok: true }> {
  const { error } = await supabaseAdmin
    .from("barbershops")
    .update({ business_type: input.business_type })
    .eq("id", input.barbershop_id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

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
    .select("id, provider, phone_number_id, meta_access_token, instance_id, instance_token, uazapi_instance_id, uazapi_instance_token")
    .eq("barbershop_id", input.barbershop_id)
    .maybeSingle();

  // Se os campos genéricos (instance_id/instance_token) ainda guardam dados
  // da UAZAPI (ou seja, o modo ativo ANTES dessa troca já era uazapi),
  // preserva esses valores nas colunas dedicadas antes de trocar — sem
  // isso, trocar pra "meta" e depois de volta pra "uazapi" perdia a
  // instância, forçando criar uma nova a cada troca.
  const preservedUazapiId =
    (existing?.provider === "uazapi" ? existing.instance_id : null) ?? existing?.uazapi_instance_id ?? null;
  const preservedUazapiToken =
    (existing?.provider === "uazapi" ? existing.instance_token : null) ?? existing?.uazapi_instance_token ?? null;

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
        uazapi_instance_id: preservedUazapiId,
        uazapi_instance_token: preservedUazapiToken,
      }
    : {
        barbershop_id: input.barbershop_id,
        provider: "uazapi",
        // Reaproveita a instância UAZAPI já existente (preservada mesmo que
        // o modo ativo antes fosse "meta") — só fica null se realmente
        // nunca existiu uma instância UAZAPI pra essa barbearia ainda.
        instance_id: preservedUazapiId,
        instance_token: preservedUazapiToken,
        status: "disconnected",
        phone: null,
        last_qr: null,
        last_synced_at: now,
        uazapi_instance_id: preservedUazapiId,
        uazapi_instance_token: preservedUazapiToken,
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

export type PendingMetaConnectionRow = {
  id: string;
  waba_id: string;
  phone_number_id: string;
  phone: string | null;
  meta_business_id: string | null;
  is_coexistence: boolean;
  created_at: string;
};

/** Conexões vindas do link de Integração Zero que ainda não foram
 * atribuídas a nenhuma barbearia — a Meta não manda nenhum identificador
 * de qual conta iniciou esse vínculo, então fica pendente de revisão
 * manual (pelo telefone/nome que aparece) até um admin reivindicar. */
export async function listPendingMetaConnections(supabaseAdmin: Admin): Promise<PendingMetaConnectionRow[]> {
  const { data, error } = await supabaseAdmin
    .from("pending_meta_connections")
    .select("id, waba_id, phone_number_id, phone, meta_business_id, is_coexistence, created_at")
    .is("claimed_barbershop_id", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Move uma conexão pendente pra virar a conexão de verdade de uma
 * barbearia específica — mesmo formato de payload que o admin salvar
 * credenciais manualmente já grava em whatsapp_instances. */
export async function claimPendingMetaConnection(
  supabaseAdmin: Admin,
  input: z.infer<typeof claimPendingSchema>,
): Promise<{ ok: true }> {
  const { data: pending, error: fetchErr } = await supabaseAdmin
    .from("pending_meta_connections")
    .select("id, waba_id, phone_number_id, phone, meta_access_token, meta_business_id, is_coexistence, claimed_barbershop_id")
    .eq("id", input.pending_id)
    .maybeSingle();
  if (fetchErr) throw new Error(fetchErr.message);
  if (!pending) throw new Error("Conexão pendente não encontrada.");
  if (pending.claimed_barbershop_id) throw new Error("Essa conexão já foi reivindicada antes.");

  const payload = {
    barbershop_id: input.barbershop_id,
    provider: "meta" as const,
    instance_id: pending.phone_number_id,
    instance_token: pending.meta_access_token,
    status: "connected" as const,
    phone: pending.phone,
    waba_id: pending.waba_id,
    phone_number_id: pending.phone_number_id,
    meta_access_token: pending.meta_access_token,
    meta_business_id: pending.meta_business_id,
    is_coexistence: pending.is_coexistence,
    last_error: null,
    last_synced_at: new Date().toISOString(),
  };
  const { data: existing } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id")
    .eq("barbershop_id", input.barbershop_id)
    .maybeSingle();
  const { error: writeErr } = existing
    ? await supabaseAdmin.from("whatsapp_instances").update(payload).eq("id", existing.id)
    : await supabaseAdmin.from("whatsapp_instances").insert(payload);
  if (writeErr) throw new Error(writeErr.message);

  const { error: claimErr } = await supabaseAdmin
    .from("pending_meta_connections")
    .update({ claimed_barbershop_id: input.barbershop_id, claimed_at: new Date().toISOString() })
    .eq("id", pending.id);
  if (claimErr) throw new Error(claimErr.message);

  return { ok: true };
}
