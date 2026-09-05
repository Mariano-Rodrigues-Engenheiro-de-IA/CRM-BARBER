// Nichos que usam terminologia de clínica ("Paciente", ficha clínica,
// etc.) em vez da terminologia de barbearia ("Cliente"). Centralizado
// aqui pra não espalhar a mesma lista de valores em vários arquivos —
// adicionar um nicho novo que também deva usar essa terminologia é só
// incluir o valor aqui, sem precisar caçar cada `=== "odontologia"`
// pelo código.
export const CLINIC_BUSINESS_TYPES = ["odontologia", "estetica"] as const;

export function isClinicNiche(businessType: string | null | undefined): boolean {
  return !!businessType && (CLINIC_BUSINESS_TYPES as readonly string[]).includes(businessType);
}
