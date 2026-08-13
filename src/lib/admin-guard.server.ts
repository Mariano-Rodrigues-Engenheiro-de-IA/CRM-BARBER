// Checagem simples de "é o administrador" — usada pra restringir
// funcionalidades ainda não liberadas pra clientes finais (ex: gestão de
// modelos de mensagem), sem precisar de um sistema de "roles" completo
// ainda. Compara o barbershop_id do token autenticado contra a lista em
// ADMIN_BARBERSHOP_ID (aceita mais de um id, separados por vírgula).
//
// Isso é deliberadamente simples/temporário — quando a funcionalidade for
// liberada pra clientes, essa checagem deve ser removida ou substituída
// por um sistema de permissões de verdade.

// Admins liberados diretamente no código (além dos que vierem por env).
const HARDCODED_ADMIN_BARBERSHOP_IDS = [
  "7348c9b5-b825-4e33-8705-3a41bca8d852", // Viver Bem Estética
];

export function isAdminBarbershop(barbershop_id: string): boolean {
  if (HARDCODED_ADMIN_BARBERSHOP_IDS.includes(barbershop_id)) return true;
  const adminIds = process.env.ADMIN_BARBERSHOP_ID;
  if (!adminIds) return false;
  return adminIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(barbershop_id);
}
