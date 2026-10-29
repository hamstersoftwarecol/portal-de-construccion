export const ROLES = ['administrador', 'supervisor', 'colaborador', 'arquitecto', 'ingeniero_civil', 'topografo', 'plomero', 'electricista', 'soldador'] as const
export type Role = (typeof ROLES)[number]

export const SPECIALTIES = ['gestion', 'arquitectura', 'ingenieria_civil', 'topografia', 'plomeria', 'electricidad', 'soldadura'] as const
export type Specialty = (typeof SPECIALTIES)[number]

export const ROLE_SPECIALTY: Record<Role, Specialty> = {
  administrador: 'gestion', supervisor: 'gestion', colaborador: 'gestion',
  arquitecto: 'arquitectura', ingeniero_civil: 'ingenieria_civil', topografo: 'topografia',
  plomero: 'plomeria', electricista: 'electricidad', soldador: 'soldadura',
}

const ALL: Role[] = [...ROLES]
const AD: Role[] = ['administrador']
const AS: Role[] = ['administrador', 'supervisor']
const TECH: Role[] = ['administrador', 'supervisor', 'arquitecto', 'ingeniero_civil']

/** Matriz única de permisos por rol dentro de un proyecto (US-03). */
export const PERMS = {
  'project.view': ALL,
  'project.edit': AD,
  'members.manage': AD,
  'members.view': ALL,
  'phase.manage': AS,
  'task.create': AS,
  'task.assign': AS,
  'task.review': AS,
  'task.viewAll': TECH,
  'task.progress': ALL,
  'dep.manage': ['administrador', 'supervisor', 'ingeniero_civil', 'arquitecto', 'plomero', 'electricista', 'soldador', 'topografo'] as Role[],
  'doc.upload': TECH,
  'doc.review': ['administrador', 'arquitecto', 'ingeniero_civil'] as Role[],
  'doc.viewAll': TECH,
  'survey.write': ['administrador', 'supervisor', 'ingeniero_civil', 'topografo'] as Role[],
  'survey.view': ALL,
  'nc.write': ['administrador', 'supervisor', 'ingeniero_civil'] as Role[],
  'nc.view': ALL,
  'appt.book': ['administrador', 'supervisor', 'colaborador', 'arquitecto', 'ingeniero_civil'] as Role[],
  'appt.viewAll': ['administrador', 'supervisor', 'colaborador', 'arquitecto', 'ingeniero_civil'] as Role[],
  'inspection.manage': AS,
  'inspection.result': ['administrador', 'supervisor', 'ingeniero_civil'] as Role[],
  'dashboard.view': AS,
  'report.export': AD,
  'comment.write': ALL,
  'invite.manage': AD,
} satisfies Record<string, Role[]>

export type Perm = keyof typeof PERMS

export const can = (role: Role | null | undefined, perm: Perm) => !!role && PERMS[perm].includes(role)
