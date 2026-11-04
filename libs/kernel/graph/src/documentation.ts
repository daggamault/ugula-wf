import type { GraphDef, PinSpec } from './types.ts';
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

const pinIssues = (side: 'input' | 'output', pins: readonly PinSpec[]): Issue[] =>
  pins.flatMap((p) => [
    ...(p.description?.trim() ? [] : [{ message: `Describe the ${side} "${p.name}"` }]),
    ...(p.label && !isTitleCase(p.label)
      ? [{ message: `Write the ${side} label "${p.label}" in Title Case` }]
      : [])
  ]);

export const documentationIssues = (def: GraphDef): Issue[] => {
  const { signature } = def;
  const exits = signature.exits ?? {};
  return [
    ...pinIssues('input', signature.inputs),
    ...pinIssues('output', signature.outputs),
    ...signature.execOut.flatMap((name) => {
      const doc = exits[name];
      return [
        ...(doc?.label?.trim() || doc?.description?.trim()
          ? []
          : [{ message: `Label or describe the exit "${name}"` }]),
        ...(doc?.label && !isTitleCase(doc.label)
          ? [{ message: `Write the exit label "${doc.label}" in Title Case` }]
          : [])
      ];
    }),
    ...def.nodes.flatMap((n) =>
      n.label && !isTitleCase(n.label)
        ? [{ node: n.id, message: `Write the label "${n.label}" in Title Case` }]
        : []
    )
  ];
};
