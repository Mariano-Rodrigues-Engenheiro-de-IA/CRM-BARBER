// Sistemas de assinatura suportados na importação de planilha.
//
// Cada sistema externo (App Barber, Frisar, ...) tem seu próprio parser
// isolado neste módulo. O painel só escolhe o id do sistema e entrega a
// matriz de células da planilha (linha 0 = cabeçalho).

export type SubscriptionSystemId = "appbarber" | "cashbarber" | "frizzar" | "manual";

export type ParsedCustomer = {
  name: string;
  phone: string;
  status: string;
  tags: string[];
  plan: string | null;
};

export type ParseReport = {
  rows: ParsedCustomer[];
  total: number;
  skipped: number;
  byStatus: Record<string, number>;
  byPlan: Record<string, number>;
  unmappedStatuses: string[];
};

/** Prefixo usado para gravar o plano do assinante como tag. */
export const PLAN_TAG_PREFIX = "plano:";

export function planTag(plan: string) {
  return PLAN_TAG_PREFIX + plan.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 34);
}

export function planFromTags(tags: string[] | null | undefined): string | null {
  const t = (tags ?? []).find((x) => x.startsWith(PLAN_TAG_PREFIX));
  return t ? t.slice(PLAN_TAG_PREFIX.length) : null;
}


export const SUBSCRIPTION_SYSTEMS: Array<{
  id: SubscriptionSystemId;
  label: string;
  hint: string;
}> = [
  {
    id: "appbarber",
    label: "App Barber",
    hint: "Exporte o relatório de assinantes (.xlsx, .xls ou .csv) do App Barber e anexe aqui.",
  },
  {
    id: "cashbarber",
    label: "Cash Barber",
    hint: "Exporte o relatório de assinantes (.xlsx, .xls ou .csv) do Cash Barber e anexe aqui.",
  },
  {
    id: "frizzar",
    label: "Frizzar",
    hint: "Exporte a lista de assinantes do Frizzar (.xlsx, .xls ou .csv).",
  },
  {
    id: "manual",
    label: "Outro sistema",
    hint: "Planilha simples com as colunas nome e telefone (.xlsx, .xls ou .csv).",
  },
];

/** Sistemas estruturados usam só as colunas que fazem sentido no fluxo de assinatura. */
const STRUCTURED_STATUSES = ["active", "due_soon", "overdue", "canceled"];

export function statusesForSystem(system: SubscriptionSystemId | null): string[] | null {
  if (system === "appbarber" || system === "cashbarber" || system === "frizzar") {
    return STRUCTURED_STATUSES;
  }
  return null; // null = mostrar todas as colunas
}

/** Telefone real (só dígitos) x placeholder de planilha sem telefone. */
export const NO_PHONE_PREFIX = "sem-tel-";

export function isSendablePhone(phone: string | null | undefined): boolean {
  return !!phone && /^\d{10,15}$/.test(phone);
}

function placeholderPhone(name: string) {
  const slug = stripAccents(name.toLowerCase()).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (NO_PHONE_PREFIX + slug).slice(0, 40);
}

/** Linhas de rodapé de relatório ("Total", "Total Ativos", ...). */
function isSummaryRow(name: string) {
  return /^total\b/i.test(name.trim());
}

// ---------- helpers ----------

function decodeEntities(v: string) {
  return v
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Célula da planilha como texto limpo. */
function cell(v: unknown) {
  return decodeEntities(String(v ?? "")).trim();
}

function stripAccents(v: string) {
  return v.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function norm(v: unknown) {
  return stripAccents(String(v ?? "").trim().toLowerCase());
}

/** Telefone BR em formato E.164 sem "+": 55DDDNUMERO. Retorna null se inválido. */
export function normalizePhone(raw: unknown): string | null {
  let d = String(raw ?? "").replace(/\D+/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length >= 12 && d.startsWith("55")) {
    // já tem DDI
  } else if (d.length === 10 || d.length === 11) {
    d = "55" + d;
  } else if (d.length === 8 || d.length === 9) {
    return null; // sem DDD, não dá pra discar
  }
  if (d.length < 12 || d.length > 13) return null;
  return d;
}

function findCol(header: string[], ...keys: string[]) {
  const h = header.map(norm);
  for (const k of keys) {
    const i = h.findIndex((c) => c.includes(k));
    if (i >= 0) return i;
  }
  return -1;
}

function cleanPlan(plan: string): string | null {
  const t = plan.trim().replace(/\s+/g, " ").slice(0, 34);
  return t ? t : null;
}

function emptyReport(): ParseReport {
  return { rows: [], total: 0, skipped: 0, byStatus: {}, byPlan: {}, unmappedStatuses: [] };
}

function pushRow(report: ParseReport, row: ParsedCustomer) {
  report.rows.push(row);
  report.byStatus[row.status] = (report.byStatus[row.status] ?? 0) + 1;
  if (row.plan) report.byPlan[row.plan] = (report.byPlan[row.plan] ?? 0) + 1;
}

/** dd/mm/aaaa (App Barber) ou aaaa-mm-dd. Retorna dias até a data (negativo = vencido). */
function daysUntil(raw: string): number | null {
  const s = raw.trim();
  let d: Date | null = null;
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (br) {
    const y = Number(br[3].length === 2 ? "20" + br[3] : br[3]);
    d = new Date(y, Number(br[2]) - 1, Number(br[1]));
  } else if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    d = new Date(s.slice(0, 10) + "T00:00:00");
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

// ---------- App Barber ----------
// Colunas nativas: Nome | Plano | Contratação | Próximo Vencimento | Status | Celular | E-mail
// Status nativos: Em Dia, A vencer, Inadimplente, Atrasado, Vencido, Cancelado/Inativo

function appBarberStatus(raw: string): string | null {
  const s = norm(raw);
  if (!s) return null;
  if (s.includes("cancelad") || s.includes("inativ") || s.includes("encerrad")) return "canceled";
  if (s.includes("inadimplente") || s.includes("atrasad") || s.includes("vencido")) return "overdue";
  if (s.includes("a vencer") || s.includes("vencendo")) return "due_soon";
  if (s.includes("em dia") || s.includes("ativo") || s.includes("pago") || s.includes("adimplente"))
    return "active";
  return null;
}

/** Fallback determinístico pelo Próximo Vencimento quando o Status não é reconhecido. */
function statusFromDueDate(rawDate: string): string | null {
  const d = daysUntil(rawDate);
  if (d === null) return null;
  if (d < 0) return "overdue";
  if (d <= 7) return "due_soon";
  return "active";
}

function parseAppBarber(matrix: string[][], origin = "appbarber"): ParseReport {
  const report = emptyReport();
  if (!matrix.length) return report;
  const header = matrix[0];
  const iName = findCol(header, "nome", "cliente", "assinante");
  const iPhone = findCol(header, "celular", "telefone", "whatsapp", "fone");
  const iStatus = findCol(header, "status", "situacao");
  const iPlan = findCol(header, "plano");
  const iDue = findCol(header, "proximo vencimento", "vencimento", "proxima cobranca");

  for (const row of matrix.slice(1)) {
    const name = cell(row[iName]);
    if (isSummaryRow(name)) continue;
    report.total += 1;
    const phone = normalizePhone(row[iPhone]);
    if (!name || !phone) {
      report.skipped += 1;
      continue;
    }
    const rawStatus = cell(row[iStatus]);
    const rawDue = iDue >= 0 ? cell(row[iDue]) : "";
    let status = appBarberStatus(rawStatus);
    if (!status) {
      if (rawStatus && !report.unmappedStatuses.includes(rawStatus)) {
        report.unmappedStatuses.push(rawStatus);
      }
      status = statusFromDueDate(rawDue) ?? "active";
    }
    const plan = iPlan >= 0 ? cleanPlan(cell(row[iPlan])) : null;
    const tags = [origin];
    if (plan) tags.push(planTag(plan));

    pushRow(report, { name, phone, status, tags, plan });
  }
  return report;
}

// ---------- Frisar ----------
// Layout ainda não confirmado: mesmos cabeçalhos equivalentes e mesmo
// mapeamento de status, marcando a origem com a tag "frisar".

function parseFrizzar(matrix: string[][]): ParseReport {
  return parseAppBarber(matrix, "frizzar");
}

// ---------- Cash Barber ----------
// Colunas nativas: Cliente | Plano | Status | Data de criação (telefone é opcional
// e nem sempre vem na exportação). Rodapé traz linhas "Total".

function parseCashBarber(matrix: string[][]): ParseReport {
  const report = emptyReport();
  if (!matrix.length) return report;
  const header = matrix[0];
  const iName = findCol(header, "cliente", "nome", "assinante");
  const iPhone = findCol(header, "celular", "telefone", "whatsapp", "fone");
  const iStatus = findCol(header, "status", "situacao");
  const iPlan = findCol(header, "plano");
  const iDue = findCol(header, "vencimento", "proxima cobranca");

  for (const row of matrix.slice(1)) {
    const name = cell(row[iName >= 0 ? iName : 0]);
    if (!name || isSummaryRow(name)) continue;
    report.total += 1;
    const phone = iPhone >= 0 ? normalizePhone(row[iPhone]) : null;
    const rawStatus = iStatus >= 0 ? cell(row[iStatus]) : "";
    let status = appBarberStatus(rawStatus);
    if (!status) {
      if (rawStatus && !report.unmappedStatuses.includes(rawStatus)) {
        report.unmappedStatuses.push(rawStatus);
      }
      status = (iDue >= 0 ? statusFromDueDate(cell(row[iDue])) : null) ?? "active";
    }
    const plan = iPlan >= 0 ? cleanPlan(cell(row[iPlan])) : null;
    const tags = ["cashbarber"];
    if (plan) tags.push(planTag(plan));
    if (!phone) tags.push("sem-telefone");
    pushRow(report, { name, phone: phone ?? placeholderPhone(name), status, tags, plan });
  }
  return report;
}

// ---------- Genérico / manual ----------

function parseGeneric(matrix: string[][]): ParseReport {
  const report = emptyReport();
  if (!matrix.length) return report;
  const header = matrix[0];
  const headerLooksLikeData = normalizePhone(header[1]) !== null || normalizePhone(header[0]) !== null;
  const iName = headerLooksLikeData ? 0 : Math.max(0, findCol(header, "nome", "cliente", "contato"));
  const iPhone = headerLooksLikeData ? 1 : findCol(header, "celular", "telefone", "whatsapp", "fone", "numero");
  const iStatus = headerLooksLikeData ? -1 : findCol(header, "status", "situacao");
  const iPlan = headerLooksLikeData ? -1 : findCol(header, "plano");
  const iDue = headerLooksLikeData ? -1 : findCol(header, "vencimento");
  const body = headerLooksLikeData ? matrix : matrix.slice(1);

  for (const row of body) {
    report.total += 1;
    const name = cell(row[iName]);
    const phone = normalizePhone(row[iPhone >= 0 ? iPhone : 1]);
    if (!name || !phone) {
      report.skipped += 1;
      continue;
    }
    const rawStatus = iStatus >= 0 ? cell(row[iStatus]) : "";
    const status =
      appBarberStatus(rawStatus) ?? (iDue >= 0 ? statusFromDueDate(cell(row[iDue])) : null) ?? "active";
    const plan = iPlan >= 0 ? cleanPlan(cell(row[iPlan])) : null;
    const tags: string[] = [];
    if (plan) tags.push(planTag(plan));
    pushRow(report, { name, phone, status, tags, plan });
  }
  return report;
}


// ---------- entrada única ----------

export function parseSubscriptionSheet(
  system: SubscriptionSystemId,
  matrix: string[][],
): ParseReport {
  if (system === "appbarber") return parseAppBarber(matrix);
  if (system === "cashbarber") return parseCashBarber(matrix);
  if (system === "frizzar") return parseFrizzar(matrix);
  return parseGeneric(matrix);
}
