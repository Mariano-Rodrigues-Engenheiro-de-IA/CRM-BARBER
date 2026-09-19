// Lógica de resolução de público para a Etapa 1 do wizard de disparo
// (DispatchCenter). Separado do componente visual porque a mesma lógica
// serve tanto pra fonte de INCLUSÃO quanto pras fontes de EXCLUSÃO — uma
// fonte é só uma fonte, resolver ela numa lista de contatos é sempre a
// mesma operação, independente de estar somando ou subtraindo da lista
// final.

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

export type AudienceContact = { phone: string; name: string };

export type AudienceResolveData = {
  contacts: WaContact[];
  labels: WaLabel[];
  funnels: Funnel[];
  customers: DispatchCustomer[];
};

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
    .map((c) => ({ phone: (c.phone || c.wa_id) as string, name: c.name || c.phone || c.wa_id }))
    .filter((c) => isRealPhone(c.phone));
}

/** Funis do tipo "label" (Listas/etiquetas) — mesma lógica de
 * funnelTargets já usada no disparo atual e em funnels-view.tsx
 * (stageCards), só que reaproveitável tanto pra inclusão quanto exclusão. */
function resolveLabelFunnel(source: AudienceSource, data: AudienceResolveData): AudienceContact[] {
  const funnel = data.funnels.find((f) => f.id === source.funnelId);
  if (!funnel) return [];
  const relevantStages = source.stageId
    ? funnel.stages.filter((s) => s.id === source.stageId)
    : funnel.stages;
  const wantedLabelIds = new Set(
    relevantStages
      .map((s) => data.labels.find((l) => l.name === s.name)?.wa_label_id)
      .filter((x): x is string => Boolean(x)),
  );
  return data.contacts
    .filter((c) => !c.is_group && c.label_ids.some((id) => wantedLabelIds.has(id)))
    .map((c) => ({ phone: (c.phone || c.wa_id) as string, name: c.name || c.phone || c.wa_id }))
    .filter((c) => isRealPhone(c.phone));
}

/** Funis normais (cards persistidos) — mesma lógica de funnelTargets já
 * usada no disparo atual. */
function resolveNormalFunnel(source: AudienceSource, data: AudienceResolveData): AudienceContact[] {
  const funnel = data.funnels.find((f) => f.id === source.funnelId);
  if (!funnel) return [];
  return funnel.cards
    .filter((c) => (source.stageId ? c.stage_id === source.stageId : true))
    .filter((c) => isRealPhone(c.phone) || c.wa_id)
    .map((c) => ({ phone: (c.phone || c.wa_id) as string, name: c.title }));
}

function resolveSubscribers(source: AudienceSource, data: AudienceResolveData): AudienceContact[] {
  const sendable = data.customers.filter((c) => isRealPhone(c.phone));
  const filtered =
    !source.subscriberStatus || source.subscriberStatus === "all"
      ? sendable
      : sendable.filter((c) => c.status === source.subscriberStatus);
  return filtered.map((c) => ({ phone: c.phone, name: c.name }));
}

function resolveSheet(source: AudienceSource): AudienceContact[] {
  return (source.sheetContacts ?? [])
    .filter((c) => isRealPhone(c.phone))
    .map((c) => ({ phone: c.phone, name: c.name || c.phone }));
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

/** Lista final = fonte de inclusão MENOS a união de todas as fontes de
 * exclusão, deduplicada por telefone (uma pessoa pode aparecer em mais de
 * uma etapa/etiqueta, mas só deve receber a mensagem 1 vez). */
export function resolveFinalAudience(
  include: AudienceSource | null,
  excludeList: AudienceSource[],
  data: AudienceResolveData,
): AudienceContact[] {
  if (!include) return [];
  const included = resolveAudienceSource(include, data);
  const excludedPhones = new Set(
    excludeList.flatMap((src) => resolveAudienceSource(src, data).map((c) => c.phone)),
  );
  const seen = new Set<string>();
  const result: AudienceContact[] = [];
  for (const c of included) {
    if (excludedPhones.has(c.phone)) continue;
    if (seen.has(c.phone)) continue;
    seen.add(c.phone);
    result.push(c);
  }
  return result;
}
