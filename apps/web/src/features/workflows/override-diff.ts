import { deepEqual, type GraphDef, type Json, type NodeInstance } from '@ugula/graph';
import { edgeId, type NodeChange } from '../../shared/graph/flow.ts';

export type Property = 'type' | 'label' | 'note' | 'config' | `input:${string}`;

export type PropertyChange = { property: Property; base: Json | undefined };

export type GraphDiff = {
  changes: Record<string, NodeChange>;
  properties: Record<string, PropertyChange[]>;
  removed: NodeInstance[];
  changedEdges: Set<string>;
  signatureChanged: boolean;
  variablesChanged: boolean;
};

const asJson = (value: unknown) => value as Json | undefined;

const same = (a: unknown, b: unknown) =>
  a === undefined || b === undefined ? a === b : deepEqual(a as Json, b as Json);

export const nodeChanges = (base: NodeInstance, mine: NodeInstance): PropertyChange[] => {
  const changes: PropertyChange[] = [];
  if (base.type !== mine.type || base.version !== mine.version) {
    changes.push({ property: 'type', base: `${base.type}@${base.version}` });
  }
  for (const key of ['label', 'note', 'config'] as const) {
    if (!same(base[key], mine[key])) changes.push({ property: key, base: asJson(base[key]) });
  }
  const pins = new Set([...Object.keys(base.inputs ?? {}), ...Object.keys(mine.inputs ?? {})]);
  for (const pin of pins) {
    const before = base.inputs?.[pin];
    if (!same(before, mine.inputs?.[pin])) {
      changes.push({ property: `input:${pin}`, base: asJson(before) });
    }
  }
  return changes;
};

export const diffGraphs = (base: GraphDef, mine: GraphDef): GraphDiff => {
  const before = new Map(base.nodes.map((n) => [n.id, n]));
  const after = new Set(mine.nodes.map((n) => n.id));
  const changes: Record<string, NodeChange> = {};
  const properties: Record<string, PropertyChange[]> = {};
  for (const n of mine.nodes) {
    const old = before.get(n.id);
    if (!old) {
      changes[n.id] = 'added';
      continue;
    }
    const changed = nodeChanges(old, n);
    if (changed.length) {
      changes[n.id] = 'changed';
      properties[n.id] = changed;
    }
  }
  const baseEdges = new Set(base.edges.map(edgeId));
  return {
    changes,
    properties,
    removed: base.nodes.filter((n) => !after.has(n.id)),
    changedEdges: new Set(mine.edges.map(edgeId).filter((id) => !baseEdges.has(id))),
    signatureChanged: !same(base.signature, mine.signature),
    variablesChanged: !same(base.variables, mine.variables)
  };
};

export const resetProperty = (
  node: NodeInstance,
  base: NodeInstance,
  property: Property
): NodeInstance => {
  if (property === 'type') return { ...node, type: base.type, version: base.version };
  if (property.startsWith('input:')) {
    const pin = property.slice('input:'.length);
    const { [pin]: _, ...rest } = node.inputs ?? {};
    const restored = base.inputs?.[pin];
    return { ...node, inputs: restored ? { ...rest, [pin]: restored } : rest };
  }
  const key = property as 'label' | 'note' | 'config';
  const { [key]: _, ...rest } = node;
  return base[key] === undefined ? rest : { ...rest, [key]: base[key] };
};

const PROPERTY_WORDS: Record<'type' | 'label' | 'note' | 'config', string> = {
  type: 'node type',
  label: 'label',
  note: 'note',
  config: 'settings'
};

export const propertyName = (property: Property) =>
  property.startsWith('input:')
    ? `input ${property.slice('input:'.length)}`
    : PROPERTY_WORDS[property as keyof typeof PROPERTY_WORDS];

export const formatBase = (value: Json | undefined) => {
  if (value === undefined) return 'Not set';
  const text =
    typeof value === 'object' && value !== null && !Array.isArray(value) && 'expr' in value
      ? `= ${String(value.expr)}`
      : typeof value === 'object' && value !== null && !Array.isArray(value) && 'value' in value
        ? JSON.stringify(value.value)
        : typeof value === 'string'
          ? value
          : JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
};

export const describeDiff = (
  base: GraphDef,
  mine: GraphDef,
  titleOf: (node: NodeInstance) => string
): string[] => {
  const diff = diffGraphs(base, mine);
  const byId = new Map(mine.nodes.map((n) => [n.id, n]));
  return [
    ...(diff.signatureChanged ? ['Changed its inputs, outputs or exits'] : []),
    ...(diff.variablesChanged ? ['Changed its variables'] : []),
    ...Object.entries(diff.changes).map(([id, change]) => {
      const node = byId.get(id);
      const title = node ? titleOf(node) : id;
      if (change === 'added') return `Added ${title}`;
      const what = (diff.properties[id] ?? []).map((p) => propertyName(p.property));
      return `Changed ${title}: ${what.join(', ')}`;
    }),
    ...diff.removed.map((n) => `Removed ${titleOf(n)}`),
    ...(diff.changedEdges.size
      ? [
          `Rewired ${diff.changedEdges.size} ${diff.changedEdges.size === 1 ? 'connection' : 'connections'}`
        ]
      : [])
  ];
};
