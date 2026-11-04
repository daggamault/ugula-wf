import { grantsOf, PERMISSIONS, type Permission } from './permissions.ts';

export const USER_ADMIN_PERMISSIONS = grantsOf(['users']);

export const canGrant = (held: readonly Permission[], requested: readonly Permission[]) =>
  requested.every((p) => held.includes(p));

export const isUserAdmin = (permissions: readonly Permission[]) =>
  canGrant(permissions, USER_ADMIN_PERMISSIONS);

const WORK = ['patients', 'imports', 'claims', 'tasks', 'payer_files'] as const;

const SETUP = ['settings', 'users', 'roles', 'payers', 'fees', 'workflows', 'runs'] as const;

export const BUILT_IN_ROLES: readonly { name: string; permissions: readonly Permission[] }[] = [
  { name: 'Admin', permissions: PERMISSIONS },
  {
    name: 'Billing Manager',
    permissions: [
      ...grantsOf([...WORK, 'payers', 'fees', 'reports', 'runs']),
      ...grantsOf(['settings', 'users', 'roles', 'workflows'], ['read']),
      'workflows:update'
    ]
  },
  {
    name: 'Biller',
    permissions: [
      ...grantsOf(WORK, ['create', 'read', 'update']),
      ...grantsOf([...SETUP, 'reports'], ['read'])
    ]
  },
  { name: 'Viewer', permissions: grantsOf([...WORK, ...SETUP, 'reports'], ['read']) }
];
