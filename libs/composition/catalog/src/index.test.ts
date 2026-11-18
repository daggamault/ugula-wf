import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PERMISSIONS } from '@ugula/access';
import { billingKinds, billingModels, createBillingNodes } from '@ugula/billing';
import {
  createModelNodes,
  createRegistry,
  createStdNodes,
  EVENT_TYPE_PATTERN,
  type GraphDef,
  isTitleCase,
  nodeDocumentationIssues,
  STD_KINDS,
  stdGraphInfo,
  stdGraphSource,
  unknownKinds
} from '@ugula/graph';
import { createNemsisNodes, encounterModels, nemsisKinds } from '@ugula/nemsis';
import { createNodeCatalog, valueKinds, workflowEvents } from './index.ts';

const UNWIRED: GraphDef = {
  signature: { execIn: [], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: [],
  edges: []
};

describe('createNodeCatalog', () => {
  it('lists the standard, encounter, billing and record nodes in that order', () => {
    const typesOf = (nodes: { type: string }[]) => nodes.map((n) => n.type);
    assert.deepEqual(typesOf(createNodeCatalog({ fetch })), [
      ...typesOf(createStdNodes({ fetch, permissions: PERMISSIONS })),
      ...typesOf(createNemsisNodes(null)),
      ...typesOf(createBillingNodes(null)),
      ...typesOf(createModelNodes([...encounterModels, ...billingModels]))
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
      ['std.text.length', 'encounter.break', 'encounter.save', 'claim.make', 'claim.save'].filter(
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
    assert.deepEqual(
      titles.filter((t) => !isTitleCase(t)),
      []
    );
  });

  it('labels every model field in Title Case and describes it', () => {
    const fields = [...encounterModels, ...billingModels].flatMap((m) =>
      m.fields.map((f) => ({ ...f, model: m.key }))
    );
    assert.deepEqual(
      fields.filter((f) => !isTitleCase(f.label) || !f.description.endsWith('.')),
      []
    );
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
      ...[...encounterModels, ...billingModels].flatMap((m) => m.fields.map((f) => f.type))
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

describe('workflowEvents', () => {
  it('names each event once, by a dotted type, with a Title Case label and a description', () => {
    const types = workflowEvents.map((e) => e.type);
    assert.equal(new Set(types).size, types.length);
    for (const e of workflowEvents) {
      assert.match(e.type, EVENT_TYPE_PATTERN);
      assert.ok(isTitleCase(e.label), e.label);
      assert.ok(e.description.endsWith('.'), e.type);
    }
  });

  it('documents every payload field with a declared kind', () => {
    for (const e of workflowEvents) {
      for (const p of e.payload) {
        assert.ok(p.label && isTitleCase(p.label) && p.description, `${e.type}.${p.name}`);
        assert.deepEqual(unknownKinds(p.type, valueKinds), [], `${e.type}.${p.name}`);
      }
    }
  });
});
