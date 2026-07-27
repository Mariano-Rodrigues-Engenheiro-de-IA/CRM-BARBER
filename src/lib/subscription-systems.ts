// Sistemas de assinatura suportados na importação de planilha.
//
// Cada sistema externo (App Barber, Frisar, ...) tem seu próprio parser
// isolado neste módulo. O painel só escolhe o id do sistema e entrega a
// matriz de células da planilha (linha 0 = cabeçalho).

export type SubscriptionSystemId = "appbarber" | "frisar" | "manual";

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
    hint: "Exporte o relatório de assinantes (.xlsx ou .csv) direto do App Barber e anexe aqui.",
  },
  {
    id: "frisar",
    label: "Frisar",
    hint: "Exporte a lista de assinantes do Frisar (.xlsx ou .csv).",
  },
  {
    id: "manual",
    label: "Outro sistema / planilha manual",
    hint: "Planilha simples com as colunas nome e telefone (.xlsx ou .csv).",
  },
];

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

function tagFromPlan(plan: string): string | null {
  const t = plan.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40);
  return t ? t : null;
}

function emptyReport(): ParseReport {
  return { rows: [], total: 0, skipped: 0, byStatus: {}, unmappedStatuses: [] };
}

// ---------- App Barber ----------
// Colunas: Nome | Plano | Contratação | Próximo Vencimento | Status | Celular | E-mail
// Status observados: Em Dia, A vencer, Inadimplente, Atrasado, Vencido, (Cancelado/Inativo)

function appBarberStatus(raw: string): string | null {
  const s = norm(raw);
  if (!s) return "active";
  if (s.includes("em dia") || s.includes("ativo") || s.includes("pago")) return "active";
  if (s.includes("a vencer") || s.includes("vencendo")) return "due_soon";
  if (s.includes("inadimplente") || s.includes("atrasad") || s.includes("vencido")) return "overdue";
  if (s.includes("cancelad") || s.includes("inativ") || s.includes("encerrad")) return "canceled";
  return null;
}

function parseAppBarber(matrix: string[][]): ParseReport {
  const report = emptyReport();
  if (!matrix.length) return report;
  const header = matrix[0];
  const iName = findCol(header, "nome", "cliente", "assinante");
  const iPhone = findCol(header, "celular", "telefone", "whatsapp", "fone");
  const iStatus = findCol(header, "status", "situacao");
  const iPlan = findCol(header, "plano");

  for (const row of matrix.slice(1)) {
    report.total += 1;
    const name = cell(row[iName]);
    const phone = normalizePhone(row[iPhone]);
    if (!name || !phone) {
      report.skipped += 1;
      continue;
    }
    const rawStatus = cell(row[iStatus]);
    const status = appBarberStatus(rawStatus);
    if (!status) {
      report.skipped += 1;
      if (rawStatus && !report.unmappedStatuses.includes(rawStatus)) {
        report.unmappedStatuses.push(rawStatus);
      }
      continue;
    }
    const tags = ["appbarber"];
    const planTag = iPlan >= 0 ? tagFromPlan(cell(row[iPlan])) : null;
    if (planTag) tags.push(planTag);

    report.rows.push({ name, phone, status, tags });
    report.byStatus[status] = (report.byStatus[status] ?? 0) + 1;
  }
  return report;
}

// ---------- Frisar ----------
// Layout ainda não confirmado: usa cabeçalhos equivalentes e o mesmo
// mapeamento de status, marcando a origem com a tag "frisar".

function parseFrisar(matrix: string[][]): ParseReport {
  const r = parseGeneric(matrix, appBarberStatus);
  for (const row of r.rows) row.tags = ["frisar", ...row.tags.filter((t) => t !== "appbarber")];
  return r;
}

// ---------- Genérico / manual ----------

function parseGeneric(
  matrix: string[][],
  statusMapper: (raw: string) => string | null = () => "active",
): ParseReport {
  const report = emptyReport();
  if (!matrix.length) return report;
  const header = matrix[0];
  const headerLooksLikeData = normalizePhone(header[1]) !== null || normalizePhone(header[0]) !== null;
  const iName = headerLooksLikeData ? 0 : Math.max(0, findCol(header, "nome", "cliente", "contato"));
  const iPhone = headerLooksLikeData ? 1 : findCol(header, "celular", "telefone", "whatsapp", "fone", "numero");
  const iStatus = headerLooksLikeData ? -1 : findCol(header, "status", "situacao");
  const iPlan = headerLooksLikeData ? -1 : findCol(header, "plano");
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
    const status = statusMapper(rawStatus) ?? "active";
    const tags: string[] = [];
    const planTag = iPlan >= 0 ? tagFromPlan(cell(row[iPlan])) : null;
    if (planTag) tags.push(planTag);
    report.rows.push({ name, phone, status, tags });
    report.byStatus[status] = (report.byStatus[status] ?? 0) + 1;
  }
  return report;
}

// ---------- entrada única ----------

export function parseSubscriptionSheet(
  system: SubscriptionSystemId,
  matrix: string[][],
): ParseReport {
  if (system === "appbarber") return parseAppBarber(matrix);
  if (system === "frisar") return parseFrisar(matrix);
  return parseGeneric(matrix);
}
