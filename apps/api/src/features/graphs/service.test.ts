import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GraphKind, GraphRole } from '@ugula/db';
import { createRecordingDb } from '@ugula/db/testing';
import {
  contractOf,
  createStdNodes,
  ENTRY_TYPE,
  type GraphDef,
  STD_KINDS,
  SUBWORKFLOW_TRIGGER
} from '@ugula/graph';
import type { CompiledQuery } from 'kysely';
import type { Scope } from '../../shared/scopes.ts';
import { testAccess } from '../../shared/testing.ts';
import { createGraphService, customizationMap, roleFor, templateFor } from './service.ts';

const nodes = createStdNodes({ fetch });

const admin = testAccess();
const editor = testAccess(['workflows:read', 'workflows:update']);
const manager = testAccess(['workflows:read', 'workflows:update', 'workflows:manage']);
const reader = testAccess(['workflows:read']);

const composite: GraphDef = {
  signature: { execIn: [], execOut: [], inputs: [{ name: 'x', type: 'number' }], outputs: [] },
  variables: [],
  nodes: [{ id: 'entry', type: ENTRY_TYPE, version: 1 }],
  edges: []
};

const flow = templateFor('workflow');

const usesComposite: GraphDef = {
  ...flow,
  nodes: [
    { id: 'entry', type: ENTRY_TYPE, version: 1 },
    { id: 'c', type: 'acme.thing', version: 2, inputs: { x: { value: 1 } } }
  ]
};

const block = templateFor('node');

const widened: GraphDef = {
  ...block,
  signature: { ...block.signature, inputs: [{ name: 'x', type: 'number' }] }
};

type Graph = {
  id: string;
  scope: Scope;
  kind?: GraphKind;
  role?: GraphRole;
  key?: string;
  overrides?: string;
  active?: boolean;
};

type Version = {
  id: string;
  version: number;
  definition: GraphDef;
  published?: boolean;
  base?: string;
};

type World = {
  graphs: Graph[];
  versions?: Record<string, Version[]>;
  fail?: { sql: string; code: string };
  dependents?: string[];
  tables?: { key: string; kind: string }[];
};

const RANK = { agency: 0, system: 1 };
const KEY = 'acme.flow';

const createWorld = ({ graphs, versions = {}, fail, dependents = [], tables = [] }: World) => {
  const keyOf = (g: Graph) => g.key ?? KEY;
  const live = graphs.filter((g) => g.active !== false);
  const versionsOf = (id: unknown) => versions[id as string] ?? [];
  const published = (id: unknown) =>
    versionsOf(id)
      .filter((v) => v.published)
      .sort((a, b) => b.version - a.version);
  const rows = (q: CompiledQuery): unknown[] => {
    const [p0, p1] = q.parameters;
    const sql = q.sql;
    if (fail && sql.startsWith(fail.sql)) {
      throw Object.assign(new Error('pg'), { code: fail.code });
    }
    if (sql.startsWith('select "g"."id", "g"."agency_id"')) {
      const g = live.find((x) => x.id === q.parameters.at(-2));
      return g
        ? [
            {
              id: g.id,
              agency_id: g.scope === 'agency' ? 't-1' : null,
              key: keyOf(g),
              name: 'Flow',
              kind: g.kind ?? 'workflow',
              role: g.role ?? ((g.kind ?? 'workflow') === 'workflow' ? 'workflow' : 'rule'),
              description: '',
              scope: g.scope,
              overrides: g.overrides ?? null,
              overridden_by: null,
              is_stale: false
            }
          ]
        : [];
    }
    if (sql.startsWith('select "g"."id" as "id", case')) {
      const [g] = live
        .filter((x) => keyOf(x) === q.parameters.at(-1))
        .sort((a, b) => RANK[a.scope] - RANK[b.scope]);
      return g ? [{ id: g.id, scope: g.scope }] : [];
    }
    if (sql.includes('from "data_tables" as "t"')) return tables;
    if (sql.startsWith('select "id", "is_active" from "graphs"')) {
      const g = graphs.find((x) => x.scope === 'agency' && keyOf(x) === q.parameters.at(-1));
      return g ? [{ id: g.id, is_active: g.active !== false }] : [];
    }
    if (sql.startsWith('select "id" from "graphs"')) {
      const g = graphs.find((x) => x.scope === 'system' && keyOf(x) === p0);
      return g ? [{ id: g.id }] : [];
    }
    if (sql.startsWith('select "id", "version", "definition", "contract"')) {
      const [v] = published(p0);
      return v ? [{ ...v, contract: contractOf(v.definition.signature) }] : [];
    }
    if (sql.includes('for update')) {
      const v = versionsOf(p0).find((x) => !x.published);
      return v ? [{ ...v, base_version_id: v.base ?? null }] : [];
    }
    if (sql.startsWith('select "id", "version", "definition", "base_version_id"')) {
      const [v] = versionsOf(p0).toSorted((a, b) => b.version - a.version);
      return v ? [{ ...v, base_version_id: v.base ?? null }] : [];
    }
    if (sql.includes('"base_graph_id"')) {
      return versionsOf(p0)
        .toSorted((a, b) => b.version - a.version)
        .map((v) => ({ id: v.id, version: v.version }));
    }
    if (sql.startsWith('select "id", "version", "definition", "published_at"')) {
      const v = versionsOf(p0).find((x) => x.version === p1);
      return v
        ? [
            {
              id: v.id,
              version: v.version,
              definition: v.definition,
              base_version_id: v.base ?? null
            }
          ]
        : [];
    }
    if (sql.trimStart().startsWith('select v.id, v.version, v.definition')) {
      for (const [graphId, list] of Object.entries(versions)) {
        const v = list.find((x) => x.id === p0);
        const g = graphs.find((x) => x.id === graphId);
        if (v && g) {
          return [
            {
              id: v.id,
              version: v.version,
              definition: v.definition,
              owner_id: g.id,
              scope: g.scope
            }
          ];
        }
      }
      return [];
    }
    if (sql.trimStart().startsWith('select distinct g.name'))
      return dependents.map((name) => ({ name }));
    if (sql.includes('from unnest')) {
      return [{ id: 'v-thing', key: 'acme.thing', version: 2, definition: composite }];
    }
    if (sql.includes('max("version")')) {
      return [{ max: Math.max(0, ...versionsOf(p0).map((v) => v.version)) }];
    }
    if (sql.startsWith('insert into "graphs"')) return [{ id: 'g-new' }];
    if (sql.startsWith('insert into "graph_versions"')) return [{ id: 'v-new', version: p1 }];
    if (sql.startsWith('delete from "graphs"')) return [{ id: p0 }];
    if (sql.startsWith('update "graphs" set "is_active"')) return [{ id: p1 }];
    return [];
  };
  const { db, queries } = createRecordingDb(rows);
  const find = (prefix: string) => queries.filter((q) => q.sql.startsWith(prefix));
  return {
    service: createGraphService({
      db,
      nodes,
      kinds: STD_KINDS,
      events: [],
      newKey: () => 'custom.k7f3x9q2ab'
    }),
    queries,
    find
  };
};

const system = (over: Partial<Graph> = {}): Graph => ({ id: 'g-sys', scope: 'system', ...over });
const agency = (over: Partial<Graph> = {}): Graph => ({ id: 'g-agency', scope: 'agency', ...over });
const sysV = (version: number, definition = flow): Version => ({
  id: `v-sys-${version}`,
  version,
  definition,
  published: true
});

const failure = (code: string, message: string) => ({ ok: false, failure: { code, message } });

const READ_ONLY = failure('forbidden', 'Standard graphs are read-only');
const NO_PERMISSION = failure('forbidden', 'You do not have permission to change this graph');
const NOT_FOUND = failure('not_found', 'Graph not found');

describe('graph templates and scopes', () => {
  it('builds starter templates per kind', () => {
    assert.deepEqual(block.signature.execOut, ['then']);
    assert.equal(block.nodes.length, 2);
    assert.equal(flow.nodes.length, 1);
  });

  it('gives workflows the workflow role and other graphs the role asked for, rules by default', () => {
    assert.equal(roleFor('workflow', 'rule'), 'workflow');
    assert.equal(roleFor('node', 'stage'), 'stage');
    assert.equal(roleFor('node', undefined), 'rule');
  });
});

describe('customization map', () => {
  it('lists each graph with the visible graphs it calls and the tables it uses', () => {
    const tableNode = {
      id: 't',
      type: 'std.table.decide',
      version: 1,
      config: { inputs: [], outputs: [], table: { key: 'acme.rates' } }
    };
    const map = customizationMap([
      {
        id: 'g1',
        key: 'acme.flow',
        name: 'Flow',
        kind: 'workflow',
        role: 'workflow',
        scope: 'system',
        definition: { ...usesComposite, nodes: [...usesComposite.nodes, tableNode] }
      },
      {
        id: 'g2',
        key: 'acme.thing',
        name: 'Thing',
        kind: 'node',
        role: 'rule',
        scope: 'agency',
        definition: composite
      }
    ]);
    assert.deepEqual(map[0]?.children, ['acme.thing']);
    assert.deepEqual(map[0]?.tables, ['acme.rates']);
    assert.deepEqual(map[1]?.children, []);
    assert.equal(map[1]?.scope, 'agency');
  });

  it('reports table nodes whose table the agency cannot see', async () => {
    const { service } = createWorld({ graphs: [] });
    const def: GraphDef = {
      ...flow,
      nodes: [
        ...flow.nodes,
        {
          id: 't',
          type: 'std.table.lookup',
          version: 1,
          config: { type: 'string', table: { key: 'acme.missing' } }
        }
      ]
    };
    const res = await service.validate(admin, def);
    assert.ok(res.ok);
    assert.deepEqual(res.value.issues, [{ node: 't', message: 'Unknown table acme.missing' }]);
  });

  it('reports a table node whose table is of another kind', async () => {
    const { service } = createWorld({
      graphs: [],
      tables: [{ key: 'acme.rates', kind: 'decide' }]
    });
    const def: GraphDef = {
      ...flow,
      nodes: [
        ...flow.nodes,
        {
          id: 'w',
          type: 'std.table.lookup',
          version: 1,
          config: { table: { key: 'acme.rates' } }
        }
      ]
    };
    const res = await service.validate(admin, def);
    assert.ok(res.ok);
    assert.deepEqual(res.value.issues, [
      { node: 'w', message: 'Table acme.rates is not a lookup table' }
    ]);
  });

  it('checks agency graphs against standard and agency graphs and tables', async () => {
    const { service, queries } = createWorld({
      graphs: [agency()],
      versions: { 'g-agency': [{ id: 'd1', version: 1, definition: flow }] }
    });
    const def: GraphDef = {
      ...usesComposite,
      nodes: [
        ...usesComposite.nodes,
        {
          id: 't',
          type: 'std.table.lookup',
          version: 1,
          config: { type: 'string', table: { key: 'acme.rates' } }
        }
      ]
    };
    assert.ok((await service.saveDraft(admin, 'g-agency', def)).ok);
    const lookup = queries.find((q) => q.sql.includes('from unnest'));
    assert.ok(lookup?.parameters.includes('t-1'));
    const tables = queries.find((q) => q.sql.includes('from "data_tables" as "t"'));
    assert.deepEqual(tables?.parameters.slice(0, 2), ['acme.rates', 't-1']);
  });
});

describe('graph service reads', () => {
  it('validates against std nodes and visible published composites', async () => {
    const { service, queries } = createWorld({ graphs: [] });
    assert.deepEqual(await service.validate(admin, usesComposite), {
      ok: true,
      value: { issues: [] }
    });
    const lookup = queries.find((q) => q.sql.includes('from unnest'));
    assert.deepEqual(lookup?.parameters.slice(0, 2), [['acme.thing'], [2]]);
    const missing = await service.validate(admin, {
      ...usesComposite,
      nodes: [...usesComposite.nodes, { id: 'z', type: 'acme.nope', version: 1 }]
    });
    assert.deepEqual(missing, {
      ok: true,
      value: { issues: [{ node: 'z', message: 'Unknown node type acme.nope@1' }] }
    });
  });

  it('reports whether the user may edit or override a graph and which graph is in effect', async () => {
    const world = createWorld({ graphs: [system(), agency({ overrides: 'g-sys' })] });
    const builtIn = await world.service.find(admin, 'g-sys');
    assert.ok(builtIn.ok);
    assert.equal(builtIn.value.graph.canEdit, false);
    assert.deepEqual(builtIn.value.graph.canOverride, true);
    assert.equal(builtIn.value.graph.effectiveId, 'g-agency');

    const asEditor = await world.service.find(editor, 'g-sys');
    assert.ok(asEditor.ok);
    assert.deepEqual(asEditor.value.graph.canOverride, false);

    const own = await world.service.find(manager, 'g-agency');
    assert.ok(own.ok);
    assert.equal(own.value.graph.canEdit, true);
    assert.deepEqual(own.value.graph.canOverride, false);
    assert.equal(own.value.graph.effectiveId, 'g-agency');

    const blocks = createWorld({ graphs: [system({ kind: 'node' })] });
    const node = await blocks.service.find(editor, 'g-sys');
    assert.ok(node.ok);
    assert.deepEqual(node.value.graph.canOverride, true);
    const stages = createWorld({ graphs: [system({ kind: 'node', role: 'stage' })] });
    const stage = await stages.service.find(editor, 'g-sys');
    assert.ok(stage.ok);
    assert.deepEqual(stage.value.graph.canOverride, false);
  });

  it('reads graphs, versions, search and nodes scoped to the agency', async () => {
    const { service, queries } = createWorld({
      graphs: [agency()],
      versions: { 'g-agency': [{ id: 'v2', version: 2, definition: composite }] }
    });
    assert.deepEqual(await service.version(admin, 'g-agency', 2), {
      ok: true,
      value: { id: 'v2', version: 2, definition: composite, base_version_id: null }
    });
    assert.deepEqual(
      await service.version(admin, 'g-agency', 3),
      failure('not_found', 'Version not found')
    );
    const search = await service.search(admin, {
      page: 1,
      pageSize: 25,
      sort: 'name',
      dir: 'asc',
      kind: [],
      scope: []
    });
    assert.deepEqual(search, {
      ok: true,
      value: { items: [], total: 0, page: 1, pageSize: 25, facets: { kind: [], scope: [] } }
    });
    assert.ok(queries.every((q) => !q.sql.includes('graphs') || q.parameters.includes('t-1')));
    assert.deepEqual(await service.nodes(admin), { ok: true, value: { nodes: [] } });
    assert.ok(queries.at(-1)?.parameters.every((p) => p === 't-1'));
  });

  it('maps every effective graph to the graphs it calls, with the effective tables', async () => {
    const graphRow = {
      id: 'g1',
      key: 'acme.flow',
      name: 'Flow',
      kind: 'workflow',
      role: 'workflow',
      scope: 'agency',
      definition: usesComposite
    };
    const thingRow = {
      ...graphRow,
      id: 'g2',
      key: 'acme.thing',
      name: 'Thing',
      kind: 'node',
      role: 'rule'
    };
    const table = { id: 't1', key: 'acme.rates', name: 'Rates', scope: 'system' };
    const { db, queries } = createRecordingDb((q) => {
      const sql = q.sql.trimStart();
      if (sql.startsWith('select g.id, g.key'))
        return [graphRow, { ...thingRow, definition: composite }];
      if (sql.startsWith('select e.id, e.key')) return [table];
      return [];
    });
    const service = createGraphService({ db, nodes, kinds: STD_KINDS, events: [] });
    assert.deepEqual(await service.map(admin), {
      ok: true,
      value: {
        graphs: [
          {
            id: 'g1',
            key: 'acme.flow',
            name: 'Flow',
            kind: 'workflow',
            role: 'workflow',
            scope: 'agency',
            children: ['acme.thing'],
            tables: []
          },
          {
            id: 'g2',
            key: 'acme.thing',
            name: 'Thing',
            kind: 'node',
            role: 'rule',
            scope: 'agency',
            children: [],
            tables: []
          }
        ],
        tables: [table]
      }
    });
    assert.equal(queries.length, 2);
    assert.ok(queries.every((q) => q.parameters.includes('t-1')));
  });

  it('reports graphs hidden from the agency as not found without writing', async () => {
    const { service, queries } = createWorld({ graphs: [agency({ active: false })] });
    assert.deepEqual(await service.find(admin, 'g-agency'), NOT_FOUND);
    assert.deepEqual(
      await service.version(admin, 'g-agency', 1),
      failure('not_found', 'Version not found')
    );
    assert.deepEqual(await service.compare(admin, 'g-agency'), NOT_FOUND);
    assert.deepEqual(await service.remove(admin, 'g-agency'), NOT_FOUND);
    assert.deepEqual(await service.saveDraft(admin, 'g-agency', block), NOT_FOUND);
    assert.deepEqual(await service.publish(admin, 'g-agency'), NOT_FOUND);
    assert.deepEqual(await service.rebase(admin, 'g-agency', 'keep'), NOT_FOUND);
    assert.deepEqual(await service.override(admin, 'g-agency'), NOT_FOUND);
    assert.ok(queries.every((q) => /^(select|begin|commit)/.test(q.sql)));
  });
});

describe('graph service compare', () => {
  it('has nothing to compare for standard graphs', async () => {
    const { service } = createWorld({ graphs: [system()], versions: { 'g-sys': [sysV(1)] } });
    assert.deepEqual(await service.compare(admin, 'g-sys'), {
      ok: true,
      value: { mine: null, copiedFrom: null, latest: null, baseChanged: false }
    });
  });

  it('compares an override with the version it copied and the newest version below it', async () => {
    const versions = {
      'g-sys': [sysV(1), sysV(2, block)],
      'g-agency': [
        { id: 'v-a1', version: 1, definition: usesComposite, published: true, base: 'v-sys-1' }
      ]
    };
    const stale = createWorld({ graphs: [system(), agency({ overrides: 'g-sys' })], versions });
    assert.deepEqual(await stale.service.compare(admin, 'g-agency'), {
      ok: true,
      value: {
        mine: { version: 1, definition: usesComposite },
        copiedFrom: { graphId: 'g-sys', scope: 'system', version: 1, definition: flow },
        latest: { version: 2, definition: block },
        baseChanged: true
      }
    });
    const current = createWorld({
      graphs: [system(), agency({ overrides: 'g-sys' })],
      versions: { ...versions, 'g-sys': [sysV(1)] }
    });
    const res = await current.service.compare(admin, 'g-agency');
    assert.equal(res.ok && res.value.baseChanged, false);
  });
});

describe('graph service create', () => {
  const input = { key: 'acme.new', name: 'New', kind: 'node', description: '' } as const;

  it('creates agency graphs with a first draft', async () => {
    const agencyWorld = createWorld({ graphs: [] });
    assert.deepEqual(await agencyWorld.service.create(manager, input), {
      ok: true,
      value: { id: 'g-new' }
    });
    const [graph] = agencyWorld.find('insert into "graphs"');
    assert.deepEqual(graph?.parameters, ['t-1', 'acme.new', 'New', 'node', 'rule', '']);
    const [draft] = agencyWorld.find('insert into "graph_versions"');
    assert.deepEqual(draft?.parameters, [
      'g-new',
      1,
      JSON.stringify(block),
      contractOf(block.signature),
      null,
      'u-1'
    ]);
  });

  it('gives a graph created without a key an opaque one the name never changes', async () => {
    const world = createWorld({ graphs: [] });
    const { key: _, ...unkeyed } = input;
    assert.deepEqual(await world.service.create(manager, unkeyed), {
      ok: true,
      value: { id: 'g-new' }
    });
    const [graph] = world.find('insert into "graphs"');
    assert.equal(graph?.parameters[1], 'custom.k7f3x9q2ab');
  });

  it('refuses users without permission, standard keys and duplicate keys', async () => {
    const { service, queries } = createWorld({ graphs: [system({ key: 'acme.new' })] });
    assert.deepEqual(await service.create(reader, input), NO_PERMISSION);
    assert.deepEqual(
      await service.create(admin, input),
      failure('conflict', 'A standard graph uses that key; override it instead')
    );
    assert.ok(!queries.some((q) => q.sql.startsWith('insert')));
    const dup = createWorld({ graphs: [], fail: { sql: 'insert into "graphs"', code: '23505' } });
    assert.deepEqual(
      await dup.service.create(admin, input),
      failure('conflict', 'A graph with that key exists')
    );
  });

  it('lets database errors other than a duplicate key surface', async () => {
    const { service } = createWorld({
      graphs: [],
      fail: { sql: 'insert into "graphs"', code: '57014' }
    });
    await assert.rejects(service.create(admin, input), { message: 'pg', code: '57014' });
  });
});

describe('graph service details', () => {
  const details = { name: 'Payer Rules', description: 'Reorders payers' };

  it('renames an agency graph and keeps its key', async () => {
    const { service, find } = createWorld({ graphs: [agency()] });
    assert.deepEqual(await service.updateDetails(admin, 'g-agency', details), {
      ok: true,
      value: { id: 'g-agency' }
    });
    const [update] = find('update "graphs"');
    assert.ok(update?.sql.startsWith('update "graphs" set "name" = $1, "description" = $2'));
    assert.ok(!update?.sql.includes('"key"'));
    assert.deepEqual(update?.parameters.slice(0, 2), ['Payer Rules', 'Reorders payers']);
  });

  it('refuses standards, customized standards and users without permission', async () => {
    const world = createWorld({ graphs: [system(), agency({ overrides: 'g-sys' })] });
    assert.deepEqual(
      await world.service.updateDetails(admin, 'g-sys', details),
      failure('forbidden', 'Standard graphs are read-only')
    );
    assert.deepEqual(
      await world.service.updateDetails(admin, 'g-agency', details),
      failure(
        'conflict',
        'A customized standard graph keeps the name and description it was copied with'
      )
    );
    const own = createWorld({ graphs: [agency()] });
    assert.deepEqual(await own.service.updateDetails(reader, 'g-agency', details), NO_PERMISSION);
    assert.equal(own.find('update "graphs"').length, 0);
  });
});

describe('graph service drafts', () => {
  it('refuses standards and workflows without manage', async () => {
    const { service, queries } = createWorld({ graphs: [system(), agency()] });
    assert.deepEqual(await service.saveDraft(admin, 'g-sys', flow), READ_ONLY);
    assert.deepEqual(await service.saveDraft(editor, 'g-agency', flow), NO_PERMISSION);
    assert.ok(!queries.some((q) => /^(insert|update)/.test(q.sql)));
  });

  it('updates the open draft or starts the next version', async () => {
    const open = createWorld({
      graphs: [agency()],
      versions: { 'g-agency': [{ id: 'd1', version: 3, definition: flow }] }
    });
    assert.deepEqual(await open.service.saveDraft(manager, 'g-agency', usesComposite), {
      ok: true,
      value: { version: 3, issues: [] }
    });
    const [update] = open.find('update "graph_versions"');
    assert.deepEqual(update?.parameters.at(-1), 'd1');
    assert.equal(open.find('insert').length, 0);

    const fresh = createWorld({
      graphs: [agency()],
      versions: { 'g-agency': [{ id: 'v3', version: 3, definition: flow, published: true }] }
    });
    assert.deepEqual(await fresh.service.saveDraft(manager, 'g-agency', usesComposite), {
      ok: true,
      value: { version: 4, issues: [] }
    });
    const [draft] = fresh.find('insert into "graph_versions"');
    assert.deepEqual(draft?.parameters.slice(0, 2), ['g-agency', 4]);
    assert.equal(draft?.parameters[4], null);
    assert.equal(fresh.find('update "graphs" set "updated_at"').length, 1);
  });

  it('lets only workflows start on their own', async () => {
    const scheduled: GraphDef = {
      ...flow,
      nodes: [
        {
          id: 'entry',
          type: ENTRY_TYPE,
          version: 1,
          config: { trigger: { kind: 'schedule', every: 'day', hour: 6 } }
        },
        ...flow.nodes.slice(1)
      ]
    };
    const save = async (kind: GraphKind) => {
      const world = createWorld({ graphs: [agency({ kind })] });
      const saved = await world.service.saveDraft(manager, 'g-agency', scheduled);
      return saved.ok ? saved.value.issues : saved;
    };
    assert.deepEqual(await save('workflow'), []);
    assert.deepEqual(await save('node'), [{ message: SUBWORKFLOW_TRIGGER }]);
  });

  it('locks the graph before looking for its draft, so two first saves cannot both insert one', async () => {
    const { service, queries } = createWorld({ graphs: [agency()] });
    await service.saveDraft(manager, 'g-agency', usesComposite);
    const lock = queries.findIndex(
      (q) => q.sql === 'select "id" from "graphs" where "id" = $1 for update'
    );
    const draft = queries.findIndex((q) => q.sql.includes('for update') && q !== queries[lock]);
    assert.ok(lock >= 0 && lock < draft);
    assert.deepEqual(queries[lock]?.parameters, ['g-agency']);
  });

  it('bases new drafts of an override on the newest standard', async () => {
    const world = createWorld({
      graphs: [system(), agency({ overrides: 'g-sys' })],
      versions: { 'g-sys': [sysV(2)] }
    });
    await world.service.saveDraft(manager, 'g-agency', flow);
    assert.equal(world.find('insert into "graph_versions"')[0]?.parameters[4], 'v-sys-2');
  });
});

describe('graph service publish', () => {
  it('publishes only clean drafts with pinned dependencies', async () => {
    const nothing = createWorld({ graphs: [agency()] });
    assert.deepEqual(
      await nothing.service.publish(admin, 'g-agency'),
      failure('conflict', 'Nothing to publish')
    );

    const unwired: GraphDef = {
      ...usesComposite,
      nodes: [...usesComposite.nodes, { id: 'n', type: 'std.text.upper', version: 1 }]
    };
    const broken = createWorld({
      graphs: [agency()],
      versions: { 'g-agency': [{ id: 'd1', version: 3, definition: unwired }] }
    });
    const failed = await broken.service.publish(admin, 'g-agency');
    assert.equal(!failed.ok && failed.failure.code, 'invalid');
    assert.equal(!failed.ok && failed.failure.message, 'Fix the issues before publishing');
    assert.equal(broken.find('update "graph_versions"').length, 0);

    const clean = createWorld({
      graphs: [agency()],
      versions: { 'g-agency': [{ id: 'd1', version: 3, definition: usesComposite }] }
    });
    assert.deepEqual(await clean.service.publish(admin, 'g-agency'), {
      ok: true,
      value: { version: 3 }
    });
    const [publish] = clean.find('update "graph_versions"');
    assert.deepEqual(publish?.parameters, [['acme.thing@2'], 'd1']);
  });

  it('refuses publishing an override that changes the contract of the standard', async () => {
    const draft = (definition: GraphDef) => ({
      graphs: [system({ kind: 'node' }), agency({ kind: 'node', overrides: 'g-sys' })],
      versions: {
        'g-sys': [sysV(1, block)],
        'g-agency': [{ id: 'd1', version: 1, definition }]
      }
    });
    const drifted = createWorld(draft(widened));
    assert.deepEqual(
      await drifted.service.publish(admin, 'g-agency'),
      failure(
        'invalid',
        'An override must keep the inputs, outputs and exits of the graph it replaces'
      )
    );
    assert.equal(drifted.find('update "graph_versions"').length, 0);
    const moved = block.nodes.map((n) => ({ ...n, position: { x: 1, y: 1 } }));
    const kept = createWorld(draft({ ...block, nodes: moved }));
    assert.deepEqual(await kept.service.publish(admin, 'g-agency'), {
      ok: true,
      value: { version: 1 }
    });
    const custom = createWorld({
      graphs: [agency({ kind: 'node' })],
      versions: { 'g-agency': [{ id: 'd1', version: 1, definition: widened }] }
    });
    assert.equal((await custom.service.publish(editor, 'g-agency')).ok, true);
  });
});

describe('graph service override', () => {
  const versions = { 'g-sys': [sysV(1), sysV(2, usesComposite)] };

  it('copies the newest published standard into an agency override', async () => {
    const toAgency = createWorld({ graphs: [system()], versions });
    assert.deepEqual(await toAgency.service.override(manager, 'g-sys'), {
      ok: true,
      value: { id: 'g-new' }
    });
    assert.deepEqual(toAgency.find('insert into "graphs"')[0]?.parameters, [
      't-1',
      KEY,
      'Flow',
      'workflow',
      'workflow',
      ''
    ]);
    const [copy] = toAgency.find('insert into "graph_versions"');
    assert.deepEqual(copy?.parameters.slice(0, 3), ['g-new', 1, JSON.stringify(usesComposite)]);
    assert.equal(copy?.parameters[4], 'v-sys-2');
  });

  it('only overrides standards that the user may edit', async () => {
    const { service, queries } = createWorld({ graphs: [system(), agency()], versions });
    assert.deepEqual(
      await service.override(admin, 'g-agency'),
      failure('conflict', 'This graph cannot be overridden for the agency')
    );
    assert.deepEqual(await service.override(editor, 'g-sys'), NO_PERMISSION);
    assert.ok(!queries.some((q) => /^(insert|update)/.test(q.sql)));
  });

  it('turns a switched-off copy back on and refuses a second active copy', async () => {
    const restored = createWorld({ graphs: [system(), agency({ active: false })], versions });
    assert.deepEqual(await restored.service.override(admin, 'g-sys'), {
      ok: true,
      value: { id: 'g-agency' }
    });
    assert.deepEqual(restored.find('update "graphs" set "is_active"')[0]?.parameters, [
      true,
      'g-agency'
    ]);
    assert.equal(restored.find('insert').length, 0);

    const twice = createWorld({ graphs: [system(), agency()], versions });
    assert.deepEqual(
      await twice.service.override(admin, 'g-sys'),
      failure('conflict', 'This graph is already overridden')
    );
    const raced = createWorld({
      graphs: [system()],
      versions,
      fail: { sql: 'insert into "graphs"', code: '23505' }
    });
    assert.deepEqual(
      await raced.service.override(admin, 'g-sys'),
      failure('conflict', 'This graph is already overridden')
    );
  });

  it('refuses to override a graph that was never published', async () => {
    const { service, find } = createWorld({ graphs: [system()] });
    assert.deepEqual(
      await service.override(admin, 'g-sys'),
      failure('conflict', 'This graph has no published version to start from')
    );
    assert.equal(find('insert').length, 0);
  });
});

describe('graph service rebase', () => {
  const graphs = [system(), agency({ overrides: 'g-sys' })];
  const base = { 'g-sys': [sysV(1), sysV(2, block)] };

  it('keeps the draft but moves its base to the newest version below', async () => {
    const { service, find } = createWorld({
      graphs,
      versions: {
        ...base,
        'g-agency': [{ id: 'd1', version: 2, definition: usesComposite, base: 'v-sys-1' }]
      }
    });
    assert.deepEqual(await service.rebase(admin, 'g-agency', 'keep'), {
      ok: true,
      value: { id: 'g-agency' }
    });
    const [update] = find('update "graph_versions"');
    assert.deepEqual(update?.parameters, [
      JSON.stringify(usesComposite),
      contractOf(usesComposite.signature),
      'v-sys-2',
      'd1'
    ]);
  });

  it('resets the draft to the newest version below', async () => {
    const { service, find } = createWorld({
      graphs,
      versions: { ...base, 'g-agency': [{ id: 'd1', version: 2, definition: usesComposite }] }
    });
    await service.rebase(admin, 'g-agency', 'reset');
    assert.deepEqual(find('update "graph_versions"')[0]?.parameters.slice(0, 3), [
      JSON.stringify(block),
      contractOf(block.signature),
      'v-sys-2'
    ]);
  });

  it('starts a rebased draft from the newest published version when none is open', async () => {
    const { service, find } = createWorld({
      graphs,
      versions: {
        ...base,
        'g-agency': [{ id: 'v-a1', version: 1, definition: flow, published: true }]
      }
    });
    await service.rebase(admin, 'g-agency', 'keep');
    const [draft] = find('insert into "graph_versions"');
    assert.deepEqual(draft?.parameters, [
      'g-agency',
      2,
      JSON.stringify(flow),
      contractOf(flow.signature),
      'v-sys-2',
      'u-1'
    ]);
  });

  it('refuses graphs with nothing below or nothing to keep', async () => {
    const custom = createWorld({ graphs: [agency()] });
    assert.deepEqual(
      await custom.service.rebase(admin, 'g-agency', 'keep'),
      failure('conflict', 'This graph does not override another graph')
    );
    const empty = createWorld({ graphs, versions: base });
    assert.deepEqual(
      await empty.service.rebase(admin, 'g-agency', 'keep'),
      failure('conflict', 'Nothing to rebase')
    );
    assert.deepEqual(await empty.service.rebase(admin, 'g-sys', 'reset'), READ_ONLY);
    assert.deepEqual(await empty.service.rebase(editor, 'g-agency', 'reset'), NO_PERMISSION);
  });
});

describe('graph service remove', () => {
  it('turns an override off instead of deleting it', async () => {
    const { service, find } = createWorld({ graphs: [system(), agency({ overrides: 'g-sys' })] });
    assert.deepEqual(await service.remove(admin, 'g-agency'), {
      ok: true,
      value: { id: 'g-agency' }
    });
    assert.deepEqual(find('update "graphs" set "is_active"')[0]?.parameters, [false, 'g-agency']);
    assert.equal(find('delete').length, 0);
  });

  it('deletes custom graphs unless runs still use them, and never standards', async () => {
    const gone = createWorld({ graphs: [system(), agency()] });
    assert.deepEqual(await gone.service.remove(admin, 'g-agency'), {
      ok: true,
      value: { id: 'g-agency' }
    });
    assert.deepEqual(gone.find('delete from "graphs"')[0]?.parameters, ['g-agency']);
    assert.deepEqual(await gone.service.remove(admin, 'g-sys'), READ_ONLY);
    const used = createWorld({
      graphs: [agency()],
      fail: { sql: 'delete from "graphs"', code: '23001' }
    });
    assert.deepEqual(
      await used.service.remove(admin, 'g-agency'),
      failure('conflict', 'Runs still use this graph, so it cannot be removed')
    );
    const broken = createWorld({
      graphs: [agency()],
      fail: { sql: 'delete from "graphs"', code: '57014' }
    });
    await assert.rejects(broken.service.remove(admin, 'g-agency'), { code: '57014' });
  });

  it('keeps a custom graph that published graphs still call', async () => {
    const one = createWorld({ graphs: [agency()], dependents: ['Flow A'] });
    assert.deepEqual(
      await one.service.remove(admin, 'g-agency'),
      failure('conflict', 'Flow A uses this graph, so it cannot be removed')
    );
    assert.equal(one.find('delete from "graphs"').length, 0);
    const lookup = one.queries.find((q) => q.sql.includes('select distinct g.name'));
    assert.deepEqual(lookup?.parameters, ['g-agency', 't-1', 'acme.flow']);
    const two = createWorld({ graphs: [agency()], dependents: ['Flow A', 'Flow B'] });
    assert.deepEqual(
      await two.service.remove(admin, 'g-agency'),
      failure('conflict', 'Flow A, Flow B use this graph, so it cannot be removed')
    );
  });
});
