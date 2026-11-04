import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sql } from 'kysely';
import {
  buildCopyRunTables,
  buildPinRunTables,
  findTableDefinitions,
  resolvedTable
} from './data-tables.ts';
import { createDummyDb, createRecordingDb } from './testing.ts';

const flat = (text: string) => text.replace(/\s+/g, ' ');

describe('data table queries', () => {
  it('resolves a table from the agency, then its organization, then the system', async () => {
    const db = createDummyDb();
    const compiled = sql`select ${resolvedTable('t-1', sql.lit('billing.base-rate'))}`.compile(db);
    const text = flat(compiled.sql);
    assert.ok(
      text.includes('order by t.agency_id is null, t.organization_id is null, v.version desc')
    );
    assert.ok(text.includes('(base.contract is null or v.contract = base.contract)'));
    assert.ok(text.includes('t.is_active and v.published_at is not null'));
    assert.deepEqual(compiled.parameters, ['t-1', 't-1']);
    await db.destroy();
  });

  it('pins every table the run graphs reference, reusing the parent run pins first', async () => {
    const db = createDummyDb();
    const own = buildPinRunTables('r-1', 't-1', null).compile(db);
    const text = flat(own.sql);
    assert.ok(text.includes('insert into workflow_run_tables (run_id, key, table_version_id)'));
    assert.ok(text.includes('jsonb_path_query(gv.definition, $'));
    assert.ok(own.parameters.some((p) => String(p).includes('std.table.decide')));
    assert.ok(!text.includes('workflow_run_tables p'));
    const child = flat(buildPinRunTables('r-2', 't-1', 'p-1').compile(db).sql);
    assert.ok(child.includes('select p.table_version_id from workflow_run_tables p'));
    const copy = buildCopyRunTables('r-1', ['r-2']).compile(db);
    assert.deepEqual(copy.parameters, [['r-2'], 'r-1']);
    await db.destroy();
  });

  it('loads pinned table definitions with their kind, each once', async () => {
    const { db, queries } = createRecordingDb(() => [
      { id: 'tv-1', kind: 'decide', definition: {} }
    ]);
    assert.deepEqual(await findTableDefinitions(db, []), []);
    assert.equal(queries.length, 0);
    assert.deepEqual(await findTableDefinitions(db, ['tv-1', 'tv-1']), [
      { id: 'tv-1', kind: 'decide', definition: {} }
    ]);
    assert.deepEqual(queries[0]?.parameters, ['tv-1']);
    await db.destroy();
  });
});
