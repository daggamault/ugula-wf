import {
  PERMISSION_ACTIONS,
  PERMISSION_RESOURCES,
  type Permission,
  type PermissionAction,
  type PermissionResource
} from '@ugula/access';
import { classNamesOf } from '../../shared/class-names.ts';
import { interactiveClasses } from '../../shared/ui/interactive.ts';
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
  manage: 'Manage'
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
    <div className="border-border overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <caption className="sr-only">Permissions</caption>
        <thead>
          <tr className="border-border border-b">
            <th
              scope="col"
              className="text-surface-fg-muted px-4 py-3 text-left text-xs font-semibold tracking-wide uppercase"
            >
              Area
            </th>
            {actions.map((a) => (
              <th
                key={a}
                scope="col"
                className="text-surface-fg-muted px-4 py-3 text-left text-xs font-semibold tracking-wide uppercase"
              >
                {ACTION_LABELS[a]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {PERMISSION_RESOURCES.map((resource) => (
            <tr key={resource}>
              <th scope="row" className="px-4 py-3 text-left align-middle font-medium">
                {RESOURCE_LABELS[resource]}
              </th>
              {actions.map((action) => {
                const grant = byKey.get(`${resource}:${action}` as Permission);
                if (!grant) return <td key={action} className="px-4 py-3" />;
                const checked = selected.includes(grant.permission);
                const disabled = readOnly || !grant.isGrantable;
                const box = (
                  <input
                    type="checkbox"
                    aria-label={`${ACTION_LABELS[action]} ${RESOURCE_LABELS[resource]}`}
                    title={grant.description}
                    checked={checked}
                    disabled={disabled}
                    onChange={() => onChange?.(toggled(selected, grant.permission))}
                    className={classNamesOf(
                      interactiveClasses,
                      'accent-primary size-4 rounded enabled:cursor-pointer disabled:opacity-60'
                    )}
                  />
                );
                return (
                  <td key={action} className="px-4 py-3 align-middle">
                    {!readOnly && !grant.isGrantable ? (
                      <Tooltip label="You can't grant permissions you don't hold." side="top">
                        {box}
                      </Tooltip>
                    ) : (
                      box
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
