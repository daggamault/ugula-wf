import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db/testing';
import { ENTRY_TYPE, type GraphDef } from '@ugula/graph';
import { buildUpsertGraph, buildUpsertPublishedVersion, type SeedGraph } from './graphs.ts';

const base: GraphDef = {
  signature: { execIn: [], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: [
    { id: 'entry', type: ENTRY_TYPE, version: 1 },
    { id: 'a', type: 'std.math.add', version: 1 }
  ],
  edges: []
};

const graph: SeedGraph = {
  key: 'demo.thing',
  name: 'Thing',
  kind: 'node',
  description: '',
  version: 1,
  definition: { ...base, nodes: [...base.nodes, { id: 'c', type: 'demo.other', version: 2 }] }
};

describe('graph seeds', () => {
  it('upserts global graphs by key', async () => {
    const db = createDummyDb();
    const { sql } = buildUpsertGraph(db, graph).compile();
    assert.ok(sql.includes('insert into "graphs"'));
    assert.ok(sql.includes('on conflict ("tenant_id", "key") do update set'));
    await db.destroy();
  });

  it('publishes versions and rewrites a definition only when it was edited in place', async () => {
    const db = createDummyDb();
    const compiled = buildUpsertPublishedVersion(db, 'g1', graph, ['v9']).compile();
    assert.ok(compiled.sql.includes('on conflict ("graph_id", "version") do update set'));
    assert.ok(
      compiled.sql.includes(
        '"graph_versions"."definition" is distinct from "excluded"."definition"'
      )
    );
    assert.ok(compiled.parameters.includes(JSON.stringify(graph.definition)));
    await db.destroy();
  });
});
