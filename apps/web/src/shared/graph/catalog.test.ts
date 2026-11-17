import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ENTRY_TYPE,
  type GraphDef,
  INPUT_TYPE,
  type Json,
  type NodeInstance,
  RETURN_TYPE,
  type Signature
} from '@ugula/graph';
import { testNodes } from '../testing.ts';
import { createCatalog, OPENS_LABELS, type PublishedNode, titleFromKey } from './catalog.ts';

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

const signature: Signature = {
  execIn: [],
  execOut: [],
  inputs: [{ name: 'a', type: 'string' }],
  outputs: []
};

const published = (patch: Partial<PublishedNode>): PublishedNode => ({
  graph_id: 'g-s',
  key: 'acme.score',
  name: 'Score',
  kind: 'node',
  role: 'rule',
  overridden: false,
  description: 'Scores a claim.',
  version: 1,
  signature,
  ...patch
});

const node = (type: string, patch: Partial<NodeInstance> = {}): NodeInstance => ({
  id: 'n',
  type,
  version: 1,
  ...patch
});

const descriptionOf = (type: string) => testNodes.find((d) => d.type === type)?.description;

describe('titleFromKey', () => {
  it('labels a key from its last part', () => {
    assert.equal(titleFromKey('demo.line-total'), 'Line Total');
    assert.equal(titleFromKey('score'), 'Score');
  });
});

describe('OPENS_LABELS', () => {
  it('names what each kind of called graph opens as', () => {
    assert.deepEqual(OPENS_LABELS, { graph: 'Subworkflow', workflow: 'Workflow', rule: 'Rule' });
  });
});

describe('createCatalog palette', () => {
  const catalog = createCatalog(testNodes, {
    published: [
      published({ name: 'Score v2', version: 2 }),
      published({}),
      published({
        graph_id: 'g-c',
        key: 'acme.cycle',
        name: 'Cycle',
        kind: 'workflow',
        role: 'workflow'
      })
    ]
  });
  const find = (type: string) => catalog.palette.filter((p) => p.type === type);

  it('offers each std node in its category with its level and keywords', () => {
    assert.deepEqual(find('std.math.clamp'), [
      {
        type: 'std.math.clamp',
        version: 1,
        title: 'Clamp',
        category: 'Math',
        description: 'Keeps a number between a minimum and a maximum.',
        level: 'basic',
        keywords: []
      }
    ]);
    const [expr] = find('std.expr');
    assert.equal(expr?.level, 'advanced');
    assert.equal(expr?.keywords.includes('formula'), true);
  });

  it('files a std composite under the category of its sibling nodes', () => {
    assert.equal(find('encounter.break')[0]?.category, 'Encounter');
    assert.equal(find('std.math.average')[0]?.category, 'Math');
  });

  it('offers the graph input and return, but never the start', () => {
    assert.deepEqual(
      [...find(INPUT_TYPE), ...find(RETURN_TYPE)].map((p) => p.category),
      ['Graph', 'Graph']
    );
    assert.equal(
      find(RETURN_TYPE)[0]?.description,
      'Finishes this graph and hands the values wired into it back as outputs.'
    );
    assert.deepEqual(find(ENTRY_TYPE), []);
  });

  it('offers only the latest version of each published node, filed by its kind', () => {
    assert.deepEqual(find('acme.score'), [
      {
        type: 'acme.score',
        version: 2,
        title: 'Score v2',
        category: 'Custom Nodes',
        description: 'Scores a claim.',
        level: 'basic',
        keywords: []
      }
    ]);
    assert.equal(find('acme.cycle')[0]?.category, 'Workflows');
    assert.equal(catalog.published.length, 3);
  });

  it('sorts by category, then title', () => {
    const keys = catalog.palette.map((p) => `${p.category}\u0000${p.title}`);
    assert.deepEqual(
      keys,
      [...keys].sort((a, b) => a.localeCompare(b))
    );
  });

  it('describes every std entry in a full sentence', () => {
    assert.deepEqual(
      createCatalog(testNodes)
        .palette.filter((e) => !e.description.endsWith('.'))
        .map((e) => e.type),
      []
    );
  });
});

describe('createCatalog signatureOf', () => {
  const catalog = createCatalog(testNodes, {
    published: [published({})],
    graphs: [{ type: 'acme.full', version: 1, definition: owner }]
  });

  it("gives the start node the owner's inputs as outputs", () => {
    assert.deepEqual(catalog.signatureOf(node(ENTRY_TYPE), owner)?.outputs, owner.signature.inputs);
  });

  it('resolves a published node from its signature', () => {
    assert.deepEqual(catalog.signatureOf(node('acme.score'), owner), signature);
  });

  it('is null for an unknown node', () => {
    assert.equal(catalog.signatureOf(node('nope'), owner), null);
  });
});

describe('createCatalog titleOf', () => {
  const catalog = createCatalog(testNodes, { published: [published({})] });

  it("prefers the node's own label", () => {
    assert.equal(catalog.titleOf(node('std.math.add', { label: 'Sum' })), 'Sum');
  });

  it('names a graph input by its pin', () => {
    assert.equal(catalog.titleOf(node(INPUT_TYPE, { config: { pin: 'claimId' } })), 'Get Claim ID');
  });

  it('uses the title of a std node, std composite or published node', () => {
    assert.equal(catalog.titleOf(node('std.math.clamp')), 'Clamp');
    assert.equal(catalog.titleOf(node('acme.score')), 'Score');
  });

  it('titles the start by what starts the workflow, and the return as Return', () => {
    const events = [
      { type: 'encounter.created', label: 'Encounter Created', description: '', payload: [] }
    ];
    const titled = createCatalog(testNodes, { events });
    const start = (trigger: Json) => titled.titleOf(node(ENTRY_TYPE, { config: { trigger } }));
    assert.equal(titled.titleOf(node(ENTRY_TYPE)), 'Start');
    assert.equal(
      start({ kind: 'event', event: 'encounter.created', where: {} }),
      'On Encounter Created'
    );
    assert.equal(start({ kind: 'schedule', every: 'day', hour: 6 }), 'On Schedule');
    assert.equal(titled.titleOf(node(ENTRY_TYPE, { label: 'Begin' })), 'Begin');
    assert.equal(catalog.titleOf(node(RETURN_TYPE)), 'Return');
  });

  it('labels an unknown node from its type', () => {
    assert.equal(catalog.titleOf(node('acme.match-patient')), 'Match Patient');
  });
});

describe('createCatalog describe', () => {
  const catalog = createCatalog(testNodes, { published: [published({})] });

  it('describes the start and return nodes', () => {
    assert.equal(
      catalog.describe(node(ENTRY_TYPE)),
      'Where this graph starts. Its inputs are available from here to every node that needs them.'
    );
    assert.equal(
      catalog.describe(node(RETURN_TYPE)),
      'Finishes this graph and hands the values wired into it back as outputs.'
    );
  });

  it('uses the description of a std node or published node', () => {
    assert.equal(catalog.describe(node('std.math.add')), descriptionOf('std.math.add'));
    assert.equal(catalog.describe(node('acme.score')), 'Scores a claim.');
  });

  it('is empty for an unknown node', () => {
    assert.equal(catalog.describe(node('nope')), '');
  });
});

describe('createCatalog settings', () => {
  const catalog = createCatalog(testNodes);
  const task = node('std.human.task', {
    config: { title: 'Match payer', queue: 'billing', outcomes: ['done'] }
  });

  it('knows which nodes have settings', () => {
    assert.equal(catalog.hasConfig(node('std.expr')), true);
    assert.equal(catalog.hasConfig(node('std.math.add')), false);
    assert.ok(catalog.configSchemaOf(task));
    assert.equal(catalog.configSchemaOf(node('std.math.add')), undefined);
  });

  it('summarizes valid settings', () => {
    assert.equal(catalog.summaryOf(task), 'Task: Match payer');
  });

  it('summarizes nothing for invalid settings or a node without a summary', () => {
    assert.equal(catalog.summaryOf({ ...task, config: { title: '' } }), null);
    assert.equal(catalog.summaryOf(node('std.math.add')), null);
    assert.equal(catalog.summaryOf(node('nope')), null);
  });
});

describe('createCatalog exitsOf', () => {
  it("reads a node's documented exits", () => {
    assert.equal(
      createCatalog(testNodes).exitsOf(node('std.flow.branch'), owner).true?.label,
      'True'
    );
  });

  it("reads a called graph's exits from its signature", () => {
    const catalog = createCatalog(testNodes, {
      graphs: [
        {
          type: 'acme.rule',
          version: 1,
          definition: {
            ...owner,
            signature: { ...owner.signature, exits: { exec: { label: 'Done' } } }
          }
        }
      ]
    });
    assert.deepEqual(catalog.exitsOf(node('acme.rule'), owner), { exec: { label: 'Done' } });
  });

  it('has no exits for an unknown node', () => {
    assert.deepEqual(createCatalog(testNodes).exitsOf(node('nope'), owner), {});
  });
});

describe('createCatalog graphOf', () => {
  it('finds a full graph or a std composite', () => {
    const catalog = createCatalog(testNodes, {
      graphs: [{ type: 'acme.full', version: 1, definition: owner }]
    });
    assert.ok(catalog.graphOf({ type: 'acme.full', version: 1 }) === owner);
    assert.ok(catalog.graphOf({ type: 'std.math.average', version: 1 }));
    assert.equal(catalog.graphOf({ type: 'acme.full', version: 2 }), undefined);
  });
});

describe('createCatalog opensAs and publishedOf', () => {
  const catalog = createCatalog(testNodes, {
    published: [
      published({}),
      published({
        graph_id: 'g-c',
        key: 'acme.cycle',
        name: 'Cycle',
        kind: 'workflow',
        role: 'workflow',
        version: 3
      })
    ]
  });
  const start = node('std.flow.start-workflow', { config: { workflow: 'acme.cycle', version: 3 } });
  const each = node('std.list.map-rule', { config: { rule: 'acme.score', version: 1, item: 'x' } });

  it('opens a published node or std composite as a subworkflow', () => {
    assert.equal(catalog.opensAs(node('acme.score')), 'graph');
    assert.equal(catalog.opensAs(node('std.math.average')), 'graph');
    assert.equal(catalog.publishedOf(node('acme.score'))?.graph_id, 'g-s');
  });

  it('opens the workflow a start node starts', () => {
    assert.equal(catalog.opensAs(start), 'workflow');
    assert.equal(catalog.publishedOf(start)?.graph_id, 'g-c');
  });

  it('opens the rule a list node runs on each item', () => {
    assert.equal(catalog.opensAs(each), 'rule');
    assert.equal(catalog.publishedOf(each)?.graph_id, 'g-s');
  });

  it('opens nothing for a plain node or a start node without a workflow', () => {
    assert.equal(catalog.opensAs(node('std.math.add')), null);
    assert.equal(catalog.opensAs(node('std.flow.start-workflow')), null);
    assert.equal(catalog.publishedOf(node('std.math.add')), undefined);
  });
});

describe('createCatalog kindOf', () => {
  const catalog = createCatalog(testNodes);
  const kind = (type: string) => {
    const inst = node(type);
    return catalog.kindOf(inst, catalog.signatureOf(inst, owner));
  };

  it('colors the start and return nodes as entries', () => {
    assert.equal(kind(ENTRY_TYPE), 'entry');
    assert.equal(kind(RETURN_TYPE), 'entry');
  });

  it('colors called graphs', () => {
    assert.equal(kind('std.math.average'), 'call');
  });

  it('colors human, table and flow nodes by their category', () => {
    assert.equal(kind('std.human.task'), 'human');
    assert.equal(kind('std.table.lookup'), 'table');
    assert.equal(kind('std.flow.delay'), 'flow');
  });

  it('tells pure nodes from actions by their signature', () => {
    assert.equal(kind('std.math.add'), 'pure');
    assert.equal(kind('std.var.set'), 'action');
    assert.equal(catalog.kindOf(node('nope'), null), 'action');
  });
});
