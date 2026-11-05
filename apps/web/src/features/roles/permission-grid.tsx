import {
  PERMISSION_ACTIONS,
  PERMISSION_RESOURCES,
  type Permission,
  type PermissionAction,
  type PermissionResource
} from '@ugula/access';
import { Checkbox } from '../../shared/ui/checkbox.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { Tooltip } from '../../shared/ui/tooltip.tsx';
import type { PermissionGrant } from './client.ts';

export const RESOURCE_LABELS: Record<PermissionResource, string> = {
  settings: 'Settings',
  users: 'Users',
  roles: 'Roles',
  patients: 'Patients',
  imports: 'Imports',
  claims: 'Claims',
  tasks: 'Tasks',
  payer_files: 'Payer Files',
  payers: 'Payers',
  facilities: 'Facilities',
  fees: 'Fees',
  reports: 'Reports',
  workflows: 'Workflows',
  runs: 'Runs'
};

const ACTION_LABELS: Record<PermissionAction, string> = {
  create: 'Create',
  read: 'View',
  update: 'Change',
  delete: 'Delete',
  manage: 'Manage',
  approve: 'Approve'
};

const usedActions = (grants: readonly PermissionGrant[]) =>
  PERMISSION_ACTIONS.filter((a) => grants.some((g) => g.permission.endsWith(`:${a}`)));

export const toggled = (selected: readonly Permission[], permission: Permission) =>
  selected.includes(permission)
    ? selected.filter((p) => p !== permission)
    : [...selected, permission].sort();

type PermissionGridProps = {
  grants: readonly PermissionGrant[];
  selected: readonly Permission[];
  readOnly?: boolean;
  onChange?: (next: Permission[]) => void;
};

export const PermissionGrid = ({ grants, selected, readOnly, onChange }: PermissionGridProps) => {
  const actions = usedActions(grants);
  const byKey = new Map(grants.map((g) => [g.permission, g]));
  return (
    <Table label="Permissions" head={['Area', ...actions.map((a) => ACTION_LABELS[a])]}>
      {PERMISSION_RESOURCES.map((resource) => (
        <TableRow key={resource}>
          <TableCell>
            <span className="font-medium">{RESOURCE_LABELS[resource]}</span>
          </TableCell>
          {actions.map((action) => {
            const grant = byKey.get(`${resource}:${action}` as Permission);
            if (!grant) return <TableCell key={action} />;
            const box = (
              <Checkbox
                aria-label={`${ACTION_LABELS[action]} ${RESOURCE_LABELS[resource]}`}
                title={grant.description}
                checked={selected.includes(grant.permission)}
                disabled={readOnly || !grant.isGrantable}
                onChange={() => onChange?.(toggled(selected, grant.permission))}
              />
            );
            return (
              <TableCell key={action}>
                {!readOnly && !grant.isGrantable ? (
                  <Tooltip label="You can't grant permissions you don't hold." side="top">
                    {box}
                  </Tooltip>
                ) : (
                  box
                )}
              </TableCell>
            );
          })}
        </TableRow>
      ))}
    </Table>
  );
};
