export const PERMISSION_RESOURCES = [
  'settings',
  'users',
  'roles',
  'patients',
  'imports',
  'claims',
  'tasks',
  'payer_files',
  'payers',
  'fees',
  'reports',
  'workflows',
  'runs'
] as const;

export type PermissionResource = (typeof PERMISSION_RESOURCES)[number];

export const PERMISSION_ACTIONS = ['create', 'read', 'update', 'delete', 'manage'] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export const PERMISSIONS = [
  'settings:read',
  'settings:update',
  'users:create',
  'users:read',
  'users:update',
  'users:delete',
  'roles:create',
  'roles:read',
  'roles:update',
  'roles:delete',
  'patients:read',
  'patients:update',
  'imports:create',
  'imports:read',
  'claims:read',
  'claims:update',
  'tasks:read',
  'tasks:update',
  'payer_files:create',
  'payer_files:read',
  'payers:create',
  'payers:read',
  'payers:update',
  'payers:delete',
  'fees:create',
  'fees:read',
  'fees:update',
  'fees:delete',
  'reports:read',
  'workflows:read',
  'workflows:update',
  'workflows:manage',
  'runs:create',
  'runs:read',
  'runs:update'
] as const satisfies readonly `${PermissionResource}:${PermissionAction}`[];

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  'settings:read': 'See the billing profile and clearinghouse settings.',
  'settings:update': 'Change the billing profile and clearinghouse settings.',
  'users:create': 'Invite users to the agency.',
  'users:read': 'See the agency’s users and invitations.',
  'users:update': 'Change the role of a user.',
  'users:delete': 'Remove users from the agency.',
  'roles:create': 'Create roles.',
  'roles:read': 'See roles and their permissions.',
  'roles:update': 'Change roles and their permissions.',
  'roles:delete': 'Delete roles.',
  'patients:read': 'See patients.',
  'patients:update': 'Change patients.',
  'imports:create': 'Upload NEMSIS files.',
  'imports:read': 'See imports and what each report became.',
  'claims:read': 'See claims, their files and history.',
  'claims:update': 'Change claims, restart their cycle and check eligibility.',
  'tasks:read': 'See tasks.',
  'tasks:update': 'Work and assign tasks.',
  'payer_files:create': 'Upload payer files.',
  'payer_files:read': 'See payer files and their lines.',
  'payers:create': 'Add payers to the directory.',
  'payers:read': 'See the payer directory.',
  'payers:update': 'Change payers.',
  'payers:delete': 'Remove payers.',
  'fees:create': 'Add fees.',
  'fees:read': 'See fee schedules.',
  'fees:update': 'Change fees.',
  'fees:delete': 'Remove fees.',
  'reports:read': 'Run reports.',
  'workflows:read': 'See workflows and how they are customized.',
  'workflows:update': 'Customize rules, tables and agency rule slots.',
  'workflows:manage': 'Customize stages and workflows, and create new ones.',
  'runs:create': 'Start workflow runs.',
  'runs:read': 'See workflow runs.',
  'runs:update': 'Retry and cancel workflow runs.'
};

export const isPermission = (value: string): value is Permission =>
  (PERMISSIONS as readonly string[]).includes(value);

export const grantsOf = (
  resources: readonly PermissionResource[],
  actions: readonly PermissionAction[] = PERMISSION_ACTIONS
): Permission[] =>
  PERMISSIONS.filter((p) => {
    const [resource, action] = p.split(':') as [PermissionResource, PermissionAction];
    return resources.includes(resource) && actions.includes(action);
  });
