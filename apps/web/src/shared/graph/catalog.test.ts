import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, type GraphDef, RETURN_TYPE } from '@ugula/graph';
import { createCatalog, titleFromKey } from './catalog.ts';

const owner: GraphDef = {
  signature: {
    execIn: ['exec'],
    execOut: [],
    inputs: [{ name: 'x', type: 'number' }],
    outputs: []
  },
  variables: [],
  nodes: [],
  edges: []
};

const signature = {
  execIn: [],
  execOut: [],
  inputs: [{ name: 'a', type: 'string' as const }],
  outputs: []
};

describe('createCatalog', () => {
  it('builds a categorized palette from std nodes, std composites and published nodes', () => {
    const catalog = createCatalog({
      published: [
        {
          graph_id: 'g-x',
          key: 'acme.score',
          name: 'Score v2',
          kind: 'node',
          description: '',
          version: 2,
          signature
        },
        {
          graph_id: 'g-x',
          key: 'acme.score',
          name: 'Score',
          kind: 'node',
          description: '',
          version: 1,
          signature
        }
      ]
    });
    const find = (type: string) => catalog.palette.filter((p) => p.type === type);
    assert.equal(find('std.math.add')[0]?.category, 'Math');
    assert.deepEqual(find('std.math.clamp')[0], {
      type: 'std.math.clamp',
      version: 1,
      title: 'Clamp',
      category: 'Math',
      description: 'Keeps a number between a minimum and a maximum.'
    });
    assert.deepEqual(
      find('acme.score').map((p) => p.version),
      [2]
    );
    assert.equal(find(RETURN_TYPE)[0]?.category, 'Graph');
    assert.equal(find('nemsis.split')[0]?.category, 'NEMSIS');
    assert.equal(find(ENTRY_TYPE).length, 0);
  });

  it('resolves signatures and titles without throwing on unknown nodes', () => {
    const catalog = createCatalog({
      published: [
        {
          graph_id: 'g-x',
          key: 'acme.score',
          name: 'Score',
          kind: 'node',
          description: '',
          version: 1,
          signature
        }
      ],
      graphs: [{ type: 'acme.full', version: 1, definition: owner }]
    });
    const entry = { id: 'e', type: ENTRY_TYPE, version: 1 };
    assert.deepEqual(catalog.signatureOf(entry, owner)?.outputs, owner.signature.inputs);
    assert.deepEqual(
      catalog.signatureOf({ id: 's', type: 'acme.score', version: 1 }, owner),
      signature
    );
    assert.equal(catalog.signatureOf({ id: 'z', type: 'nope', version: 1 }, owner), null);
    assert.equal(catalog.titleOf({ id: 's', type: 'acme.score', version: 1 }), 'Score');
    assert.equal(
      catalog.titleOf({ id: 'a', type: 'std.math.add', version: 1, label: 'Sum' }),
      'Sum'
    );
    assert.equal(
      catalog.titleOf({ id: 'z', type: 'acme.match-patient', version: 1 }),
      'Match Patient'
    );
    assert.match(catalog.describe({ id: 'a', type: 'std.math.add', version: 1 }), /\w/);
    assert.match(
      catalog.describe({ id: 'e', type: ENTRY_TYPE, version: 1 }),
      /^Where this graph starts/
    );
    assert.equal(
      catalog.describe({ id: 'c', type: 'std.math.clamp', version: 1 }),
      'Keeps a number between a minimum and a maximum.'
    );
    assert.equal(catalog.titleOf({ id: 'c', type: 'std.math.clamp', version: 1 }), 'Clamp');
    assert.equal(catalog.describe({ id: 'z', type: 'nope', version: 1 }), '');
    assert.equal(catalog.hasConfig({ id: 'x', type: 'std.expr', version: 1 }), true);
    assert.equal(catalog.hasConfig({ id: 'a', type: 'std.math.add', version: 1 }), false);
    assert.ok(!createCatalog().palette.some((e) => !e.description.endsWith('.')));
    assert.equal(catalog.graphOf({ type: 'acme.full', version: 1 }), owner);
    assert.ok(catalog.graphOf({ type: 'std.math.average', version: 1 }));
    assert.equal(titleFromKey('demo.line-total'), 'Line Total');
  });

  it('knows which nodes open a sub-graph or a started workflow', () => {
    const catalog = createCatalog({
      published: [
        {
          graph_id: 'g-s',
          key: 'acme.score',
          name: 'Score',
          kind: 'node',
          description: '',
          version: 1,
          signature
        },
        {
          graph_id: 'g-c',
          key: 'acme.cycle',
          name: 'Cycle',
          kind: 'workflow',
          description: '',
          version: 3,
          signature
        }
      ]
    });
    const score = { id: 's', type: 'acme.score', version: 1 };
    const start = {
      id: 'w',
      type: 'std.flow.start-workflow',
      version: 1,
      config: { workflow: 'acme.cycle', version: 3 }
    };
    assert.equal(catalog.opensAs(score), 'graph');
    assert.equal(catalog.opensAs(start), 'workflow');
    assert.equal(catalog.opensAs({ id: 'a', type: 'std.math.add', version: 1 }), null);
    assert.equal(catalog.opensAs({ id: 'b', type: 'std.flow.start-workflow', version: 1 }), null);
    assert.equal(catalog.publishedOf(score)?.graph_id, 'g-s');
    assert.equal(catalog.publishedOf(start)?.graph_id, 'g-c');
  });
});
