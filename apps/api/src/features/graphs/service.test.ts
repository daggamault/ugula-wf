import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createStdNodes, ENTRY_TYPE, type GraphDef } from '@ugula/graph';
import type { CompiledQuery } from 'kysely';
import { createGraphService, keepsContract, templateFor } from './service.ts';

const nodes = createStdNodes({ fetch });

const composite: GraphDef = {
  signature: { execIn: [], execOut: [], inputs: [{ name: 'x', type: 'number' }], outputs: [] },
  variables: [],
  nodes: [{ id: 'entry', type: ENTRY_TYPE, version: 1 }],
  edges: []
};

const usesComposite: GraphDef = {
  ...templateFor('workflow'),
  nodes: [
    { id: 'entry', type: ENTRY_TYPE, version: 1 },
    { id: 'c', type: 'acme.thing', version: 2, inputs: { x: { value: 1 } } }
  ]
};

type Scenario = {
  owner: string | null;
  draft?: { id: string; version: number };
  definition?: GraphDef;
  system?: GraphDef;
  copy?: { id: string; is_active: boolean };
  overrides?: string;
};

const rowsFor =
  ({ owner, draft, definition, system, copy, overrides }: Scenario) =>
  (q: CompiledQuery): unknown[] => {
    if (q.sql.startsWith('select "id", "is_active"')) return copy ? [copy] : [];
    if (q.sql.includes('"tenant_id" is null') && q.sql.startsWith('select "id", "key"')) {
      return system ? [{ id: 'g-sys', key: 'acme.flow', name: 'Flow', kind: 'node' }] : [];
    }
    if (q.sql.includes('"published_at" is not null') && q.sql.includes('limit')) {
      return system ? [{ id: 'v-sys', version: 2, definition: system }] : [];
    }
    if (q.sql.includes('from "graphs"') && q.sql.includes('"tenant_id" = $')) {
      return [
        {
          id: 'g1',
          tenant_id: owner,
          key: 'acme.flow',
          name: 'Flow',
          kind: 'workflow',
          overrides: overrides ?? null
        }
      ];
    }
    if (q.sql.includes('cross join lateral')) {
      return [{ id: 'v-thing', key: 'acme.thing', version: 2, definition: composite }];
    }
    if (q.sql.includes('for update')) return draft ? [draft] : [];
    if (q.sql.includes('max("version")')) return [{ max: 3 }];
    if (q.sql.startsWith('insert into "graph_versions"')) return [{ id: 'new', version: 4 }];
    if (q.sql.startsWith('insert into "graphs"')) return [{ id: 'g-new' }];
    if (q.sql.startsWith('select "definition"')) return [{ definition }];
    return [];
  };

describe('graph service', () => {
  it('builds starter templates per kind', () => {
    assert.deepEqual(templateFor('node').signature.execOut, ['then']);
    assert.equal(templateFor('node').nodes.length, 2);
    assert.equal(templateFor('workflow').nodes.length, 1);
  });

  it('validates against std nodes and visible published composites', async () => {
    const { db, queries } = createRecordingDb(rowsFor({ owner: 't-1' }));
    const service = createGraphService({ db, nodes });
    assert.deepEqual(await service.validate('t-1', usesComposite), {
      ok: true,
      value: { issues: [] }
    });
    assert.ok(queries.some((q) => JSON.stringify(q.parameters).includes('acme.thing')));
    const missing = await service.validate('t-1', {
      ...usesComposite,
      nodes: [...usesComposite.nodes, { id: 'z', type: 'acme.nope', version: 1 }]
    });
    assert.deepEqual(missing, {
      ok: true,
      value: { issues: [{ node: 'z', message: 'Unknown node type acme.nope@1' }] }
    });
  });

  it('creates graphs with a first draft', async () => {
    const { db, queries } = createRecordingDb(rowsFor({ owner: 't-1' }));
    assert.deepEqual(
      await createGraphService({ db, nodes }).create('t-1', 'u-1', {
        key: 'acme.flow',
        name: 'Flow',
        kind: 'node',
        description: ''
      }),
      { ok: true, value: { id: 'g-new' } }
    );
    const draft = queries.find((q) => q.sql.startsWith('insert into "graph_versions"'));
    assert.deepEqual(draft?.parameters.slice(0, 2), ['g-new', 1]);
  });

  it('updates the open draft or starts the next version', async () => {
    const open = createRecordingDb(rowsFor({ owner: 't-1', draft: { id: 'd1', version: 3 } }));
    const res = await createGraphService({ db: open.db, nodes }).saveDraft(
      't-1',
      'u-1',
      'g1',
      usesComposite
    );
    assert.deepEqual(res, { ok: true, value: { version: 3, issues: [] } });
    assert.ok(open.queries.some((q) => q.sql.startsWith('update "graph_versions"')));

    const fresh = createRecordingDb(rowsFor({ owner: 't-1' }));
    const next = await createGraphService({ db: fresh.db, nodes }).saveDraft(
      't-1',
      'u-1',
      'g1',
      usesComposite
    );
    assert.deepEqual(next, { ok: true, value: { version: 4, issues: [] } });
  });

  it('refuses edits to system graphs and publishes only clean drafts with pinned dependencies', async () => {
    const system = createRecordingDb(rowsFor({ owner: null }));
    assert.deepEqual(await createGraphService({ db: system.db, nodes }).publish('t-1', 'g1'), {
      ok: false,
      failure: { code: 'forbidden', message: 'System graphs are read-only' }
    });

    const nothing = createRecordingDb(rowsFor({ owner: 't-1' }));
    const nothingToPublish = await createGraphService({ db: nothing.db, nodes }).publish(
      't-1',
      'g1'
    );
    assert.equal(!nothingToPublish.ok && nothingToPublish.failure.code, 'conflict');

    const unwired: GraphDef = {
      ...usesComposite,
      nodes: [...usesComposite.nodes, { id: 'n', type: 'std.math.add', version: 1 }]
    };
    const broken = createRecordingDb(
      rowsFor({ owner: 't-1', draft: { id: 'd1', version: 3 }, definition: unwired })
    );
    const failed = await createGraphService({ db: broken.db, nodes }).publish('t-1', 'g1');
    assert.equal(failed.ok, false);
    assert.equal(!failed.ok && failed.failure.code, 'invalid');

    const clean = createRecordingDb(
      rowsFor({ owner: 't-1', draft: { id: 'd1', version: 3 }, definition: usesComposite })
    );
    assert.deepEqual(await createGraphService({ db: clean.db, nodes }).publish('t-1', 'g1'), {
      ok: true,
      value: { version: 3 }
    });
    const publish = clean.queries.find((q) => q.sql.includes('"published_at" = now()'));
    assert.deepEqual(publish?.parameters[0], ['acme.thing@2']);
  });

  it('copies a system graph into a tenant override that must keep its contract', async () => {
    const system = createRecordingDb(rowsFor({ owner: null, system: composite }));
    assert.deepEqual(
      await createGraphService({ db: system.db, nodes }).override('t-1', 'u-1', 'g1'),
      { ok: true, value: { id: 'g-new' } }
    );
    const copied = system.queries.find((q) => q.sql.startsWith('insert into "graph_versions"'));
    assert.equal(copied?.parameters[2], JSON.stringify(composite));

    const restored = createRecordingDb(
      rowsFor({ owner: null, system: composite, copy: { id: 'g-old', is_active: false } })
    );
    assert.deepEqual(
      await createGraphService({ db: restored.db, nodes }).override('t-1', 'u-1', 'g1'),
      { ok: true, value: { id: 'g-old' } }
    );
    assert.ok(restored.queries.some((q) => q.sql.startsWith('update "graphs" set "is_active"')));
    const twice = createRecordingDb(
      rowsFor({ owner: null, system: composite, copy: { id: 'g-old', is_active: true } })
    );
    const again = await createGraphService({ db: twice.db, nodes }).override('t-1', 'u-1', 'g1');
    assert.equal(!again.ok && again.failure.code, 'conflict');

    const own = createRecordingDb(rowsFor({ owner: 't-1', system: composite }));
    const refused = await createGraphService({ db: own.db, nodes }).override('t-1', 'u-1', 'g1');
    assert.equal(!refused.ok && refused.failure.code, 'conflict');

    const changed: GraphDef = {
      ...composite,
      signature: { ...composite.signature, inputs: [{ name: 'y', type: 'number' }] }
    };
    const drifted = createRecordingDb(
      rowsFor({
        owner: 't-1',
        draft: { id: 'd1', version: 1 },
        definition: changed,
        system: composite
      })
    );
    const failed = await createGraphService({ db: drifted.db, nodes }).publish('t-1', 'g1');
    assert.equal(!failed.ok && failed.failure.code, 'invalid');
    assert.equal(
      keepsContract(composite.signature, {
        ...composite.signature,
        inputs: [{ name: 'x', type: 'number', label: 'X' }]
      }),
      true
    );

    const blocked = await createGraphService({ db: own.db, nodes }).create('t-1', 'u-1', {
      key: 'acme.flow',
      name: 'Flow',
      kind: 'node',
      description: ''
    });
    assert.equal(!blocked.ok && blocked.failure.code, 'conflict');
  });

  it('turns an override off, and deletes other tenant graphs unless runs still use them', async () => {
    const override = createRecordingDb(rowsFor({ owner: 't-1', overrides: 'g-sys' }));
    assert.deepEqual(await createGraphService({ db: override.db, nodes }).remove('t-1', 'g1'), {
      ok: true,
      value: { id: 'g1' }
    });
    const off = override.queries.find((q) => q.sql.startsWith('update "graphs" set "is_active"'));
    assert.equal(off?.parameters[0], false);
    assert.ok(!override.queries.some((q) => q.sql.startsWith('delete')));

    const own = rowsFor({ owner: 't-1' });
    const used = createRecordingDb((q) => {
      if (q.sql.startsWith('delete from "graphs"')) {
        throw Object.assign(new Error('restrict'), { code: '23001' });
      }
      return own(q);
    });
    const res = await createGraphService({ db: used.db, nodes }).remove('t-1', 'g1');
    assert.equal(!res.ok && res.failure.code, 'conflict');
    const gone = createRecordingDb((q) =>
      q.sql.startsWith('delete from "graphs"') ? [{ id: 'g1' }] : own(q)
    );
    assert.deepEqual(await createGraphService({ db: gone.db, nodes }).remove('t-1', 'g1'), {
      ok: true,
      value: { id: 'g1' }
    });
    const system = createRecordingDb(rowsFor({ owner: null }));
    const refused = await createGraphService({ db: system.db, nodes }).remove('t-1', 'g1');
    assert.equal(!refused.ok && refused.failure.code, 'not_found');
  });

  it('reports duplicate keys as conflicts', async () => {
    const { db } = createRecordingDb((q) => {
      if (q.sql.startsWith('insert into "graphs"')) {
        throw Object.assign(new Error('dup'), { code: '23505' });
      }
      return [];
    });
    const res = await createGraphService({ db, nodes }).create('t-1', 'u-1', {
      key: 'acme.flow',
      name: 'Flow',
      kind: 'node',
      description: ''
    });
    assert.deepEqual(res, {
      ok: false,
      failure: { code: 'conflict', message: 'A graph with that key exists' }
    });
  });

  it('reads graphs and versions scoped to the tenant', async () => {
    const { db } = createRecordingDb(rowsFor({ owner: 't-1' }));
    const service = createGraphService({ db, nodes });
    assert.equal((await service.find('t-1', 'g1')).ok, true);
    assert.equal((await service.version('t-1', 'g1', 1)).ok, false);
    assert.equal(
      (
        await service.search('t-1', {
          page: 1,
          pageSize: 25,
          sort: 'name',
          dir: 'asc',
          show: 'all'
        })
      ).ok,
      true
    );
    assert.equal((await service.nodes('t-1')).ok, true);
  });
});
