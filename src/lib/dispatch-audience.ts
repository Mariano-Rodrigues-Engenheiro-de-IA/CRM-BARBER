// Lógica de resolução de público para a Etapa 1 do wizard de disparo
// (DispatchCenter). Separado do componente visual porque a mesma lógica
// serve tanto pro botão "Adicionar todos" quanto "Remover todos" — uma
// fonte é só uma fonte, resolver ela numa lista de contatos é sempre a
// mesma operação, independente de estar somando ou subtraindo da seleção
// acumulada (que é o que realmente vai receber o disparo).

import { isRealPhone } from "@/lib/wa-actions";
import type { Funnel, WaContact, WaLabel } from "@/lib/funnels";
import type { SheetContact } from "@/lib/sheet-contacts";

export type DispatchCustomer = { id: string; name: string; phone: string; status: string };

export type AudienceSourceKind = "inbox" | "labels" | "funnel" | "subscribers" | "sheet";

export type AudienceSource = {
  kind: AudienceSourceKind;
  // "labels" e "funnel" usam funnelId (+ stageId opcional, "" = todas as
  // colunas/etiquetas). "subscribers" usa subscriberStatus ("all" = todos).
  funnelId?: string;
  stageId?: string;
  subscriberStatus?: string;
  // "sheet" carrega os próprios contatos junto (não tem outro id pra
  // referenciar — é a planilha que acabou de ser importada na hora).
  sheetContacts?: SheetContact[];
};

export type AudienceContact = {
  phone: string;
  name: string;
  // Identidade interna estável (WaContact.id), quando a fonte vem do
  // WhatsApp (Inbox, Listas, Funil) — usada como chave de match
  // PRIORITÁRIA em vez do telefone. Assinantes e Planilha não têm essa
  // referência (não vêm do WhatsApp), continuam usando telefone.
  id?: string;
};

export type AudienceResolveData = {
  contacts: WaContact[];
  labels: WaLabel[];
  funnels: Funnel[];
  customers: DispatchCustomer[];
};

/** Garante o código do país no telefone que será REALMENTE ENVIADO —
 * sem código do país (DDD + número BR, 10 ou 11 dígitos), adiciona 55.
 * Não mexe em mais nada (preserva o "9" como veio da fonte original):
 * remover informação de um número que precisava dela quebraria o envio
 * de verdade, diferente da chave de comparação abaixo, que só decide
 * SE duas entradas são a mesma pessoa, nunca é o valor mandado pra API. */
function normalizePhoneForSend(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return "55" + digits;
  return digits;
}

/** Chave de comparação por telefone — usada como FALLBACK quando não há
 * identidade interna (id) disponível (Assinantes, Planilha). Tolera
 * código do país ausente e o "9" extra do celular (mesma lógica já
 * usada e testada no backend do CelCash, tolerantPhoneMatch,
 * evaluate-celcash-billing). */
export function phoneMatchKey(phone: string): string {
  let digits = normalizePhoneForSend(phone);
  if (digits.length === 13 && digits.startsWith("55")) {
    digits = digits.slice(0, 4) + digits.slice(5);
  }
  return digits;
}

/** Chaves de match de um contato — pode ter MAIS de uma (id e telefone
 * juntos), nunca só uma escolhida "ou ou". ⚠️ Corrigido (19/09, mesma
 * correção): se cada contato tivesse só 1 chave (id OU telefone), um
 * contato do Inbox (tem id) nunca cruzaria com o mesmo contato vindo
 * de Assinantes (sem id, só telefone) — mesmo sendo a mesma pessoa com
 * o mesmo telefone, ficariam em "grupos" de chave diferentes.
 * Retornando as duas chaves possíveis (quando aplicável), o contato
 * fica "encontrável" tanto por id quanto por telefone — cruza
 * corretamente com QUALQUER fonte, tenha ela id ou não. */
export function contactMatchKeys(c: AudienceContact): string[] {
  const keys = [`phone:${phoneMatchKey(c.phone)}`];
  if (c.id) keys.push(`id:${c.id}`);
  return keys;
}

/** Contatos sincronizados que não são grupo e ainda não viraram lead em
 * nenhum funil — mesmo conceito de "Inbox" da aba Funis (funnels-view.tsx,
 * inboxContacts). Mantido em paridade proposital: qualquer ajuste lá
 * (ex: nova condição de exclusão) deveria refletir aqui também. */
function resolveInbox(data: AudienceResolveData): AudienceContact[] {
  const contactIdsInFunnels = new Set(
    data.funnels.flatMap((f) => f.cards.map((c) => c.wa_contact_id).filter(Boolean)),
  );
  return data.contacts
    .filter((c) => !c.is_group && !contactIdsInFunnels.has(c.id))
    .map((c) => ({
      id: c.id,
      phone: normalizePhoneForSend((c.phone || c.wa_id) as string),
      name: c.name || c.phone || c.wa_id,
    }))
    .filter((c) => isRealPhone(c.phone));
}

/** Listas (funis do tipo "label"). Exige uma lista específica escolhida
 * (19/09, revertido no mesmo dia: não existe mais "todas as listas" —
 * o usuário escolhe ativamente qual lista antes de ver contatos). */
function resolveLabelFunnel(source: AudienceSource, data: AudienceResolveData): AudienceContact[] {
  if (!source.funnelId) return [];
  const funnel = data.funnels.find((f) => f.id === source.funnelId && f.mode === "label");
  if (!funnel) return [];
  const wantedLabelIds = new Set(
    funnel.stages
      .map((s) => data.labels.find((l) => l.name === s.name)?.wa_label_id)
      .filter((x): x is string => Boolean(x)),
  );
  return data.contacts
    .filter((c) => !c.is_group && c.label_ids.some((id) => wantedLabelIds.has(id)))
    .map((c) => ({
      id: c.id,
      phone: normalizePhoneForSend((c.phone || c.wa_id) as string),
      name: c.name || c.phone || c.wa_id,
    }))
    .filter((c) => isRealPhone(c.phone));
}

/** Funis normais (cards persistidos) — mesma lógica de funnelTargets já
 * usada no disparo atual. id = wa_contact_id, que aponta pro mesmo
 * WaContact.id usado em resolveInbox/resolveLabelFunnel — garante o
 * cruzamento correto mesmo quando o card não tem phone preenchido. */
function resolveNormalFunnel(source: AudienceSource, data: AudienceResolveData): AudienceContact[] {
  const funnel = data.funnels.find((f) => f.id === source.funnelId);
  if (!funnel) return [];
  return funnel.cards
    .filter((c) => (source.stageId ? c.stage_id === source.stageId : true))
    .filter((c) => isRealPhone(c.phone) || c.wa_id)
    .map((c) => ({
      id: c.wa_contact_id ?? undefined,
      phone: normalizePhoneForSend((c.phone || c.wa_id) as string),
      name: c.title,
    }));
}

function resolveSubscribers(source: AudienceSource, data: AudienceResolveData): AudienceContact[] {
  const sendable = data.customers.filter((c) => isRealPhone(c.phone));
  const filtered =
    !source.subscriberStatus || source.subscriberStatus === "all"
      ? sendable
      : sendable.filter((c) => c.status === source.subscriberStatus);
  return filtered.map((c) => ({ phone: normalizePhoneForSend(c.phone), name: c.name }));
}

function resolveSheet(source: AudienceSource): AudienceContact[] {
  return (source.sheetContacts ?? [])
    .filter((c) => isRealPhone(c.phone))
    .map((c) => ({ phone: normalizePhoneForSend(c.phone), name: c.name || c.phone }));
}

/** Resolve QUALQUER fonte (inclusão ou exclusão) numa lista de contatos.
 * Função única e reaproveitável — uma fonte não "sabe" se está sendo usada
 * pra somar ou subtrair da lista final, isso é decidido por quem chama. */
export function resolveAudienceSource(
  source: AudienceSource,
  data: AudienceResolveData,
): AudienceContact[] {
  switch (source.kind) {
    case "inbox":
      return resolveInbox(data);
    case "labels":
      return resolveLabelFunnel(source, data);
    case "funnel":
      return resolveNormalFunnel(source, data);
    case "subscribers":
      return resolveSubscribers(source, data);
    case "sheet":
      return resolveSheet(source);
    default:
      return [];
  }
}

/** Primeira opção disponível pra cada tipo de fonte. Assinantes continua
 * pré-selecionando "Todos" (mostra contatos na hora). Listas e Funil
 * agora NÃO pré-selecionam nada (pedido explícito do usuário, 19/09):
 * o usuário escolhe ativamente uma lista ou funil específico antes de
 * ver contatos, não existe mais "todas as listas" como opção. */
export function firstAvailableSource(kind: AudienceSourceKind): AudienceSource {
  if (kind === "subscribers") {
    return { kind, subscriberStatus: "all" };
  }
  return { kind };
}
