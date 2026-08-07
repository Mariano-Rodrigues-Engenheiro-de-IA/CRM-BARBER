// Checagem simples de "é o administrador" — usada pra restringir
// funcionalidades ainda não liberadas pra clientes finais (ex: gestão de
// modelos de mensagem), sem precisar de um sistema de "roles" completo
// ainda. Compara o barbershop_id do token autenticado contra a variável
// de ambiente ADMIN_BARBERSHOP_ID.
//
// Isso é deliberadamente simples/temporário — quando a funcionalidade for
// liberada pra clientes, essa checagem deve ser removida ou substituída
// por um sistema de permissões de verdade.

export function isAdminBarbershop(barbershop_id: string): boolean {
  const adminId = process.env.ADMIN_BARBERSHOP_ID;
  if (!adminId) return false;
  return barbershop_id === adminId.trim();
}
