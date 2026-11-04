import { Badge } from '../../shared/ui/badge.tsx';
import type { GraphRole, GraphScope } from './client.ts';

const SCOPE_LABELS: Readonly<Record<GraphScope, string>> = {
  system: 'Built-in',
  organization: 'Organization',
  agency: 'Agency'
};

export const scopeLabel = (scope: GraphScope) => SCOPE_LABELS[scope];

export const ScopeBadge = ({ scope }: { scope: GraphScope }) => (
  <Badge intent={scope === 'system' ? undefined : 'custom'}>{scopeLabel(scope)}</Badge>
);

export const RoleBadge = ({ role }: { role: GraphRole }) =>
  role === 'slot' ? <Badge intent="primary">Agency Rule</Badge> : null;

export const CopyBadge = ({ scope, effective }: { scope: GraphScope; effective: GraphScope }) =>
  effective === scope ? null : (
    <Badge intent="custom">
      {effective === 'agency' ? 'Has Agency Copy' : 'Has Organization Copy'}
    </Badge>
  );

export const StaleBadge = ({ stale }: { stale: boolean }) =>
  stale ? <Badge intent="warning">Base Updated</Badge> : null;
