// Preset tags and statuses for barbershop subscribers.
// The extension UI reads this list to show default chips/selects.
// Custom tags are still allowed (free text) — this is only the starting set.

export const CUSTOMER_STATUSES = [
  { value: "active", label: "Ativo" },
  { value: "due_soon", label: "A vencer" },
  { value: "overdue", label: "Em atraso" },
  { value: "reactivate", label: "Reativar" },
  { value: "canceled", label: "Cancelado" },
  { value: "lead", label: "Lead" },
] as const;

export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number]["value"];

export const CUSTOMER_STATUS_VALUES = CUSTOMER_STATUSES.map((s) => s.value) as [
  CustomerStatus,
  ...CustomerStatus[],
];

export const DEFAULT_CUSTOMER_TAGS = [
  "vip",
  "mensalista",
  "trimestral",
  "anual",
  "novo",
  "inadimplente",
  "aniversariante",
  "indicacao",
] as const;
