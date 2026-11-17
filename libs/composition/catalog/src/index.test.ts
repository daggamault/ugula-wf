import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PERMISSIONS } from '@ugula/access';
import { billingKinds, billingModels, createBillingNodes } from '@ugula/billing';
import {
  createModelNodes,
  createRegistry,
  createStdNodes,
  type GraphDef,
  nodeDocumentationIssues,
  STD_KINDS,
  stdGraphInfo,
  stdGraphSource,
  unknownKinds
} from '@ugula/graph';
import { createNemsisNodes, nemsisKinds, nemsisModels } from '@ugula/nemsis';
import { createNodeCatalog, valueKinds } from './index.ts';

const UNWIRED: GraphDef = {
  signature: { execIn: [], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: [],
  edges: []
};

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
  it('lists the standard, NEMSIS, billing and model nodes in that order', () => {
    const typesOf = (nodes: { type: string }[]) => nodes.map((n) => n.type);
    assert.deepEqual(typesOf(createNodeCatalog({ fetch })), [
      ...typesOf(createStdNodes({ fetch, permissions: PERMISSIONS })),
      ...typesOf(createNemsisNodes(null)),
      ...typesOf(createBillingNodes(null)),
      ...typesOf(createModelNodes([...nemsisModels, ...billingModels]))
    ]);
  });

  it('registers every node next to the standard graphs without a type clash', () => {
    const types = createRegistry(createNodeCatalog({ fetch }), stdGraphSource)
      .nodes()
      .map((n) => n.type);
    assert.deepEqual(
      types.filter((t, i) => types.indexOf(t) !== i),
      []
    );
    assert.deepEqual(
      ['std.text.length', 'nemsis.split', 'billing.match-patient', 'nemsis.pcr.break'].filter(
        (t) => !types.includes(t)
      ),
      []
    );
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

  it('documents every input, output and exit of every registered node', () => {
    const registry = createRegistry(createNodeCatalog({ fetch }), stdGraphSource);
    assert.deepEqual(registry.nodes().flatMap(nodeDocumentationIssues), []);
  });

  it('places every node at the basic or advanced level', () => {
    const unleveled = createNodeCatalog({ fetch })
      .filter((n) => !n.level)
      .map((n) => n.type);
    assert.deepEqual(unleveled, []);
  });

  it('merges the standard, NEMSIS and billing value kinds', () => {
    assert.deepEqual(valueKinds, {
      id: { ...STD_KINDS.id, ...nemsisKinds.id, ...billingKinds.id },
      code: { ...STD_KINDS.code, ...nemsisKinds.code, ...billingKinds.code }
    });
  });

  it('uses only the kinds the domains declare', () => {
    const registry = createRegistry(createNodeCatalog({ fetch }), stdGraphSource, valueKinds);
    const types = [
      ...registry.nodes().flatMap((n) => {
        try {
          const sig = registry.signature({ id: n.type, type: n.type, version: n.version }, UNWIRED);
          return [...sig.inputs, ...sig.outputs].map((p) => p.type);
        } catch {
          return [];
        }
      }),
      ...[...nemsisModels, ...billingModels].flatMap((m) => m.fields.map((f) => f.type))
    ];
    assert.deepEqual([...new Set(types.flatMap((t) => unknownKinds(t, valueKinds)))], []);
  });

  it('labels a code kind the same in every domain that declares it', () => {
    const clashes = Object.entries(nemsisKinds.code).filter(
      ([kind, label]) => (billingKinds.code[kind] ?? label) !== label
    );
    assert.deepEqual(clashes, []);
  });
});
