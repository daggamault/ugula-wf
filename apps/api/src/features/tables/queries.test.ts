import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { tableContract } from '@ugula/graph';
import {
  findEffectiveTable,
  findScopedTable,
  findTable,
  insertTable,
  insertTableDraft,
  listTableVersions,
  nextTableVersion,
  publishTableVersion,
  searchTables,
  setTableActive,
  updateTableDraft
} from './queries.ts';

const S = { agencyId: 'a-1', organizationId: 'o-1' };

const flat = (text = '') => text.replace(/\s+/g, ' ');

const BASE = { page: 1, pageSize: 25, sort: 'name', dir: 'asc', show: 'all' } as const;

const LOOKUP = { type: 'string', rows: [{ key: 'a', value: 'A' }] };

describe('table queries', () => {
  it('pages visible tables with versions, override links and staleness', async () => {
    const { db, queries } = createRecordingDb(() => [
      {
        id: 't1',
        key: 'billing.base-rate',
        name: 'Base Rate',
        kind: 'decide',
        description: '',
        scope: 'agency',
        updated_at: new Date(0),
        published: 1,
        draft: 2,
        overrides: 't-sys',
        overridden_by: null,
        is_stale: false,
        total: '1'
      }
    ]);
    const page = await searchTables(db, S, { ...BASE, q: 'Rate' });
    assert.deepEqual(page.items[0], {
      id: 't1',
      key: 'billing.base-rate',
      name: 'Base Rate',
      kind: 'decide',
      description: '',
      scope: 'agency',
      overrides: 't-sys',
      overriddenBy: null,
      isStale: false,
      publishedVersion: 1,
      draftVersion: 2,
      updatedAt: new Date(0)
    });
    const sql = flat(queries[0]?.sql);
    assert.ok(sql.includes('from "data_tables" as "t"'));
    assert.ok(sql.includes('from "data_table_versions" sv'));
    assert.ok(sql.includes('lower(t.name) like $'));
    assert.ok(sql.includes('order by lower(t.name) asc nulls last'));
    await searchTables(db, S, { ...BASE, show: 'customized' });
    assert.ok(flat(queries[1]?.sql).includes('is not null or ( select o.id from "data_tables" o'));
    await db.destroy();
  });

  it('finds a visible table, the effective table for a key and its versions', async () => {
    const { db, queries } = createRecordingDb();
    await findTable(db, S, 't1');
    await findEffectiveTable(db, S, 'billing.base-rate');
    await listTableVersions(db, 't1');
    await findScopedTable(db, { organizationId: 'o-1', agencyId: null }, 'billing.base-rate');
    const [one, effective, versions, scoped] = queries;
    assert.ok(one?.parameters.includes('t1'));
    assert.ok(flat(effective?.sql).endsWith('else 2 end limit $4'));
    assert.ok(versions?.sql.includes('"b"."table_id" as "base_table_id"'));
    assert.ok(scoped?.sql.includes('"agency_id" is null'));
    await db.destroy();
  });

  it('writes tables, drafts with their contract and publishes once', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'x', version: 1, max: 2 }]);
    await insertTable(db, {
      organizationId: 'o-1',
      agencyId: 'a-1',
      key: 'billing.codes',
      name: 'Codes',
      kind: 'lookup',
      description: ''
    });
    await insertTableDraft(db, {
      tableId: 't1',
      version: 1,
      definition: LOOKUP,
      baseVersionId: 'b1',
      userId: 'u-1'
    });
    await updateTableDraft(db, 'd1', LOOKUP);
    await publishTableVersion(db, 'd1');
    await setTableActive(db, 't1', false);
    assert.equal(await nextTableVersion(db, 't1'), 3);
    const [table, draft, update, publish, active] = queries;
    assert.deepEqual(table?.parameters, ['o-1', 'a-1', 'billing.codes', 'Codes', 'lookup', '']);
    assert.deepEqual(draft?.parameters, [
      't1',
      1,
      JSON.stringify(LOOKUP),
      tableContract(LOOKUP),
      'b1',
      'u-1'
    ]);
    assert.ok(update?.sql.includes('"published_at" is null'));
    assert.ok(publish?.sql.includes('"published_at" = now()'));
    assert.ok(active?.sql.includes('"organization_id" is not null'));
    await db.destroy();
  });
});
