import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFindGraphBundle, buildFindPublishedGraphs, findPublishedGraphs } from './graphs.ts';
import { createDummyDb } from './index.ts';

describe('shared graph queries', () => {
  it('resolves published graphs preferring tenant over system versions', async () => {
    const db = createDummyDb();
    const tenant = buildFindPublishedGraphs(db, 't-1', [{ key: 'a.b', version: 2 }]).compile();
    assert.ok(tenant.sql.includes('select distinct on ("g"."key", "gv"."version")'));
    assert.ok(tenant.sql.includes('g.tenant_id nulls last'));
    assert.deepEqual(tenant.parameters, ['t-1', 'a.b', 2]);
    const system = buildFindPublishedGraphs(db, null, [{ key: 'a.b', version: 2 }]).compile();
    assert.ok(system.sql.includes('"g"."tenant_id" is null and'));
    assert.deepEqual(await findPublishedGraphs(db, 't-1', []), []);
    await db.destroy();
  });

  it('walks version dependencies recursively', async () => {
    const db = createDummyDb();
    const compiled = buildFindGraphBundle('v-1').compile(db);
    assert.ok(compiled.sql.includes('with recursive bundle'));
    assert.deepEqual(compiled.parameters, ['v-1']);
    await db.destroy();
  });
});
