import type { Permission } from '@ugula/access';
import type { LucideIcon } from 'lucide-react';
import {
  ActivityIcon,
  BadgeDollarSignIcon,
  Building2Icon,
  ChartColumnIcon,
  FileUpIcon,
  HospitalIcon,
  ListChecksIcon,
  ReceiptTextIcon,
  SettingsIcon,
  ShieldCheckIcon,
  TableIcon,
  UserCogIcon,
  UsersIcon,
  WorkflowIcon
} from 'lucide-react';
import { ROLES_PATH } from './features/roles/roles-page.tsx';
import { FACILITIES_PATH } from './features/settings/facilities-page.tsx';
import { TASKS_PATH } from './features/tasks/tasks-page.tsx';
import { USERS_PATH } from './features/users/users-page.tsx';
import { TABLES_PATH } from './features/workflows/tables-page.tsx';

type Section = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  group?: string;
  permission: Permission;
};

export const SECTIONS: readonly Section[] = [
  {
    id: 'tasks',
    label: 'Tasks',
    href: TASKS_PATH,
    icon: ListChecksIcon,
    permission: 'tasks:read'
  },
  {
    id: 'patients',
    label: 'Patients',
    href: '/patients',
    icon: UsersIcon,
    permission: 'patients:read'
  },
  {
    id: 'imports',
    label: 'Imports',
    href: '/imports',
    icon: FileUpIcon,
    permission: 'imports:read'
  },
  {
    id: 'claims',
    label: 'Claims',
    href: '/claims',
    icon: ReceiptTextIcon,
    permission: 'claims:read'
  },
  {
    id: 'reports',
    label: 'Reports',
    href: '/reports',
    icon: ChartColumnIcon,
    permission: 'reports:read'
  },
  {
    id: 'workflows',
    label: 'Workflows',
    href: '/workflows',
    icon: WorkflowIcon,
    group: 'Automation',
    permission: 'workflows:read'
  },
  {
    id: 'tables',
    label: 'Tables',
    href: TABLES_PATH,
    icon: TableIcon,
    group: 'Automation',
    permission: 'workflows:read'
  },
  {
    id: 'runs',
    label: 'Runs',
    href: '/runs',
    icon: ActivityIcon,
    group: 'Automation',
    permission: 'runs:read'
  },
  {
    id: 'payers',
    label: 'Payers',
    href: '/payers',
    icon: Building2Icon,
    group: 'Admin',
    permission: 'payers:read'
  },
  {
    id: 'facilities',
    label: 'Facilities',
    href: FACILITIES_PATH,
    icon: HospitalIcon,
    group: 'Admin',
    permission: 'facilities:read'
  },
  {
    id: 'fees',
    label: 'Fees',
    href: '/fees',
    icon: BadgeDollarSignIcon,
    group: 'Admin',
    permission: 'fees:read'
  },
  {
    id: 'users',
    label: 'Users',
    href: USERS_PATH,
    icon: UserCogIcon,
    group: 'Admin',
    permission: 'users:read'
  },
  {
    id: 'roles',
    label: 'Roles',
    href: ROLES_PATH,
    icon: ShieldCheckIcon,
    group: 'Admin',
    permission: 'roles:read'
  },
  {
    id: 'settings',
    label: 'Settings',
    href: '/settings',
    icon: SettingsIcon,
    group: 'Admin',
    permission: 'settings:read'
  }
];

export const COLLAPSIBLE_GROUPS: readonly string[] = ['Automation', 'Admin'];

export const homeOf = (can: (permission: Permission) => boolean) =>
  (
    SECTIONS.find((s) => s.id === 'tasks' && can(s.permission)) ??
    SECTIONS.find((s) => can(s.permission))
  )?.href ?? null;
