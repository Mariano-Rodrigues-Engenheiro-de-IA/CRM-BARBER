// Checagem simples de "é o administrador" — usada pra restringir
// funcionalidades ainda não liberadas pra clientes finais (ex: gestão de
// modelos de mensagem), sem precisar de um sistema de "roles" completo
// ainda. Compara o barbershop_id do token autenticado contra a lista em
// ADMIN_BARBERSHOP_ID (aceita mais de um id, separados por vírgula) —
// única fonte de verdade, a pedido do Mariano (antes tinha uma lista
// fixa aqui no código também; foi removida de propósito, pra dar pra
// trocar quem é admin só mexendo na variável no Lovable, sem precisar
// de deploy novo).
//
// Isso é deliberadamente simples/temporário — quando a funcionalidade for
// liberada pra clientes, essa checagem deve ser removida ou substituída
// por um sistema de permissões de verdade.

export function isAdminBarbershop(barbershop_id: string): boolean {
  const adminIds = process.env.ADMIN_BARBERSHOP_ID;
  if (!adminIds) return false;
  return adminIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(barbershop_id);
}
