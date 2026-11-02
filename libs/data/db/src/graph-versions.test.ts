import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildFindPublishedGraphs,
  buildPinRunGraphs,
  dependencyOf,
  findDefinitions,
  findPublishedGraphs
} from './graph-versions.ts';
import { createDummyDb } from './testing.ts';

describe('shared graph queries', () => {
  it('resolves each requested version, letting a tenant override a system graph', async () => {
    const db = createDummyDb();
    const compiled = buildFindPublishedGraphs('t-1', [{ key: 'a.b', version: 2 }]).compile(db);
    assert.ok(compiled.sql.includes('cross join lateral'));
    assert.ok(compiled.sql.includes('order by g.tenant_id nulls last, v.version desc'));
    assert.ok(compiled.sql.includes('s.tenant_id is null'));
    assert.deepEqual(compiled.parameters.slice(0, 2), [['a.b'], [2]]);
    assert.ok(compiled.parameters.includes('t-1'));
    assert.deepEqual(await findPublishedGraphs(db, 't-1', []), []);
    assert.deepEqual(await findDefinitions(db, []), []);
    await db.destroy();
  });

  it('pins the graphs a run uses by walking dependencies for its tenant', async () => {
    const db = createDummyDb();
    const compiled = buildPinRunGraphs('r-1', 't-1', 'v-1').compile(db);
    assert.ok(compiled.sql.includes('insert into workflow_run_graphs'));
    assert.ok(compiled.sql.includes('with recursive bundle'));
    assert.ok(compiled.parameters.includes('r-1') && compiled.parameters.includes('v-1'));
    assert.equal(dependencyOf({ key: 'a.b', version: 3 }), 'a.b@3');
    await db.destroy();
  });
});
