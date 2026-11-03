import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { billingModels } from '@ugula/billing';
import { createRegistry, stdGraphInfo, stdGraphSource } from '@ugula/graph';
import { nemsisModels } from '@ugula/nemsis';
import { createNodeCatalog } from './index.ts';

const MINOR_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'but',
  'or',
  'nor',
  'as',
  'of',
  'to',
  'in',
  'on',
  'for',
  'at',
  'by',
  'from',
  'per',
  'via',
  'vs',
  'with'
]);

const lowerWordOf = (title: string) =>
  title
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ''))
    .find((w, i) => /^[a-z]/.test(w) && !(i > 0 && MINOR_WORDS.has(w)));

describe('createNodeCatalog', () => {
  it('registers the standard, NEMSIS, billing and model nodes without clashes', () => {
    const nodes = createNodeCatalog({ fetch });
    const registry = createRegistry(nodes, stdGraphSource);
    const types = registry.nodes().map((n) => n.type);
    for (const type of [
      'std.text.length',
      'nemsis.split',
      'billing.match-patient',
      'nemsis.pcr.break',
      'billing.claim.make'
    ]) {
      assert.ok(types.includes(type), type);
    }
    assert.equal(new Set(types).size, types.length);
  });

  it('titles every node in Title Case', () => {
    const titles = [
      ...createNodeCatalog({ fetch }).map((n) => n.title),
      ...Object.values(stdGraphInfo).map((g) => g.title)
    ];
    for (const title of titles) assert.equal(lowerWordOf(title), undefined, title);
  });

  it('labels pins and model fields in words rather than raw camelCase names', () => {
    const rawName = /(^|\s)[a-z]+[A-Z]\w*\s*(·|$)/;
    const labels = [
      ...createNodeCatalog({ fetch }).flatMap((node) =>
        typeof node.signature === 'function'
          ? []
          : [...node.signature.inputs, ...node.signature.outputs].map((p) => p.label ?? '')
      ),
      ...[...nemsisModels, ...billingModels].flatMap((m) => m.fields.map((f) => f.label))
    ];
    for (const label of labels) assert.doesNotMatch(label, rawName, label);
  });
});
