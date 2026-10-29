// Espejo de la matriz del servidor, solo para mostrar u ocultar controles. El servidor siempre valida.
const A = ['administrador'], AS = ['administrador', 'supervisor'], TECH = ['administrador', 'supervisor', 'arquitecto', 'ingeniero_civil']
export const PERM: Record<string, string[]> = {
  'members.manage': A, 'phase.manage': AS, 'task.create': AS, 'task.assign': AS, 'task.review': AS, 'task.viewAll': TECH,
  'doc.upload': TECH, 'doc.review': ['administrador', 'arquitecto', 'ingeniero_civil'], 'survey.write': ['administrador', 'supervisor', 'ingeniero_civil', 'topografo'],
  'nc.write': ['administrador', 'supervisor', 'ingeniero_civil'], 'appt.book': ['administrador', 'supervisor', 'colaborador', 'arquitecto', 'ingeniero_civil'],
  'inspection.manage': AS, 'inspection.result': ['administrador', 'supervisor', 'ingeniero_civil'], 'dashboard.view': AS, 'report.export': A, 'invite.manage': A,
}
export const can = (role: string | undefined, perm: string) => !!role && (PERM[perm] ?? []).includes(role)
export const roleSpecialty = (role: string) => ({ arquitecto: 'arquitectura', ingeniero_civil: 'ingenieria_civil', topografo: 'topografia', plomero: 'plomeria', electricista: 'electricidad', soldador: 'soldadura' } as Record<string, string>)[role] ?? 'gestion'
