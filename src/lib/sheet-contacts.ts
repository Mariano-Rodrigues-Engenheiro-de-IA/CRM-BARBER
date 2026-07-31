// Importação de planilha simples (Nome + Telefone) para virar público de disparo.
//
// Aceita .xlsx/.xls/.csv/.tsv. As colunas são identificadas pelo cabeçalho
// (variações comuns de "nome" e "telefone"); sem cabeçalho reconhecível,
// caímos para as duas primeiras colunas.

export type SheetContact = { name: string; phone: string };

const NAME_KEYS = ["nome", "name", "cliente", "contato", "nome completo"];
const PHONE_KEYS = ["telefone", "phone", "celular", "whatsapp", "whats", "fone", "numero", "número", "tel"];

function norm(v: unknown) {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Telefone brasileiro normalizado em dígitos (DDI 55 incluído quando falta).
 * Devolve null quando o valor não puder ser um telefone real.
 */
export function normalizeSheetPhone(raw: unknown): string | null {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  digits = digits.replace(/^0+/, "");
  if (digits.length >= 10 && digits.length <= 11) digits = `55${digits}`;
  if (digits.startsWith("550")) digits = `55${digits.slice(3)}`;
  return digits.length >= 12 && digits.length <= 13 ? digits : null;
}

/** Converte a matriz da planilha em contatos válidos (sem duplicados). */
export function matrixToContacts(matrix: string[][]): SheetContact[] {
  if (!matrix.length) return [];

  const header = matrix[0].map(norm);
  let nameIdx = header.findIndex((h) => NAME_KEYS.includes(h));
  let phoneIdx = header.findIndex((h) => PHONE_KEYS.some((k) => h.includes(k)));
  let start = 1;
  if (nameIdx < 0 || phoneIdx < 0) {
    // Sem cabeçalho reconhecível: assume coluna 1 = nome, coluna 2 = telefone.
    nameIdx = 0;
    phoneIdx = 1;
    start = 0;
  }
  if (nameIdx < 0) nameIdx = 0;

  const seen = new Set<string>();
  const out: SheetContact[] = [];
  for (let i = start; i < matrix.length; i++) {
    const row = matrix[i] || [];
    const phone = normalizeSheetPhone(row[phoneIdx]);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    out.push({ name: String(row[nameIdx] ?? "").trim().slice(0, 120) || phone, phone });
  }
  return out;
}

export async function fileToContacts(file: File): Promise<SheetContact[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, blankrows: false, defval: "" });
  return matrixToContacts(rows.map((r) => (r as unknown[]).map((c) => String(c ?? ""))));
}
