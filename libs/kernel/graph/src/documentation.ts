import * as v from 'valibot';
import type { ExitDoc, GraphDef, NodeDef, PinSpec, Signature } from './types.ts';
import type { Issue } from './validate.ts';

const MINOR_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'but',
  'by',
  'for',
  'from',
  'in',
  'into',
  'nor',
  'of',
  'on',
  'or',
  'per',
  'the',
  'to',
  'vs',
  'with'
]);

const isTitleWord = (word: string, first: boolean) => {
  const core = word.replace(/^[^A-Za-z0-9]+/, '');
  if (!/^[a-z]/.test(core)) return true;
  if (/[A-Z0-9]/.test(core.slice(1))) return true;
  return !first && MINOR_WORDS.has(core.replace(/[^a-z]+$/, ''));
};

export const isTitleCase = (label: string) =>
  label
    .trim()
    .split(/\s+/)
    .every((word, i) =>
      word.split(/[/-]/).every((part, j) => isTitleWord(part, i === 0 && j === 0))
    );

const undescribed = (side: 'input' | 'output', pins: readonly PinSpec[]): Issue[] =>
  pins.flatMap((p) =>
    p.description?.trim() ? [] : [{ message: `Describe the ${side} "${p.name}"` }]
  );

const pinIssues = (side: 'input' | 'output', pins: readonly PinSpec[]): Issue[] =>
  pins.flatMap((p) => [
    ...undescribed(side, [p]),
    ...(p.label && !isTitleCase(p.label)
      ? [{ message: `Write the ${side} label "${p.label}" in Title Case` }]
      : [])
  ]);

const exitIssues = (names: readonly string[], exits: Record<string, ExitDoc> = {}): Issue[] =>
  names.flatMap((name) => {
    const doc = exits[name];
    return [
      ...(doc?.label?.trim() || doc?.description?.trim()
        ? []
        : [{ message: `Label or describe the exit "${name}"` }]),
      ...(doc?.label && !isTitleCase(doc.label)
        ? [{ message: `Write the exit label "${doc.label}" in Title Case` }]
        : [])
    ];
  });

const signatureIssues = (signature: Signature, exits: readonly string[]): Issue[] => [
  ...pinIssues('input', signature.inputs),
  ...pinIssues('output', signature.outputs),
  ...exitIssues(exits, signature.exits)
];

export const documentationIssues = (def: GraphDef): Issue[] => [
  ...signatureIssues(def.signature, def.signature.execOut),
  ...def.nodes.flatMap((n) =>
    n.label && !isTitleCase(n.label)
      ? [{ node: n.id, message: `Write the label "${n.label}" in Title Case` }]
      : []
  )
];

const UNWIRED: GraphDef = {
  signature: { execIn: [], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: [],
  edges: []
};

const placedSignature = (def: NodeDef): Signature | null => {
  if (typeof def.signature !== 'function') return def.signature;
  const config = def.config ? v.safeParse(def.config, {}) : { success: true, output: {} };
  if (!config.success) return null;
  try {
    return def.signature(config.output, { graph: UNWIRED });
  } catch {
    return null;
  }
};

export const nodeDocumentationIssues = (def: NodeDef): Issue[] => {
  const signature = placedSignature(def);
  const issues = signature
    ? [
        ...undescribed('input', signature.inputs),
        ...undescribed('output', signature.outputs),
        ...exitIssues(
          signature.execOut.filter((name) => name !== 'then'),
          def.exits
        )
      ]
    : exitIssues(Object.keys(def.exits ?? {}), def.exits);
  return issues.map((i) => ({ ...i, node: def.type }));
};

export const nameLabel = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

export const pathLabel = (path: string) => path.split('.').map(nameLabel).join(' › ');
