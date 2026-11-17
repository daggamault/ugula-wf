import { Badge } from '../../shared/ui/badge.tsx';
import type { ColumnFilter } from '../../shared/ui/column-filters.tsx';
import type { GraphScope } from './client.ts';

const SCOPE_LABELS: Readonly<Record<GraphScope, string>> = {
  system: 'Standard',
  agency: 'Custom'
};

export const scopeLabel = (scope: GraphScope) => SCOPE_LABELS[scope];

const isScope = (value: string): value is GraphScope => Object.hasOwn(SCOPE_LABELS, value);

export const SCOPE_FILTER: ColumnFilter = {
  key: 'scope',
  label: 'Scope',
  labelOf: (o) => (isScope(o.value) ? scopeLabel(o.value) : o.value)
};

export const ScopeBadge = ({ scope }: { scope: GraphScope }) => (
  <Badge intent={scope === 'system' ? undefined : 'custom'}>{scopeLabel(scope)}</Badge>
);

export const CopyBadge = ({ scope, effective }: { scope: GraphScope; effective: GraphScope }) =>
  effective === scope ? null : <Badge intent="custom">Has Custom Copy</Badge>;

export const StaleBadge = ({ stale }: { stale: boolean }) =>
  stale ? <Badge intent="warning">Base Updated</Badge> : null;
