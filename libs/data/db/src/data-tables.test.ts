import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sql } from 'kysely';
import {
  AGENCY_TABLE_PREFIX,
  buildCopyRunTables,
  buildPinRunTables,
  findGraphTables,
  findTableDefinitions,
  resolvedTable
} from './data-tables.ts';
import { createDummyDb, createRecordingDb } from './testing.ts';

const flat = (text: string) => text.replace(/\s+/g, ' ');

describe('data table queries', () => {
  it('resolves a table from the agency, then the system', async () => {
    const db = createDummyDb();
    const compiled = sql`select ${resolvedTable('t-1', sql.lit('billing.base-rate'))}`.compile(db);
    const text = flat(compiled.sql);
    assert.ok(text.includes('order by t.agency_id is null, v.version desc'));
    assert.ok(text.includes('st.agency_id is null'));
    assert.ok(!text.includes('organization'));
    assert.ok(text.includes('(base.contract is null or v.contract = base.contract)'));
    assert.ok(text.includes('t.is_active and v.published_at is not null'));
    assert.deepEqual(compiled.parameters, ['t-1']);
    await db.destroy();
  });

  it('resolves an agency-defined table only for the agency that owns it', async () => {
    const db = createDummyDb();
    const key = `${AGENCY_TABLE_PREFIX}region-reasons`;
    const compiled = sql`select ${resolvedTable('t-1', sql`${key}`)}`.compile(db);
    const text = flat(compiled.sql);
    assert.ok(text.includes('t.agency_id is null or ( t.agency_id = $2::uuid'));
    assert.ok(text.includes('st.key = t.key and st.agency_id is null'));
    assert.deepEqual(compiled.parameters, [key, 't-1']);
    const pin = buildPinRunTables('r-1', 't-2', null).compile(db);
    assert.ok(pin.parameters.includes('t-2') && !pin.parameters.includes('t-1'));
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

  it('resolves every table some graph versions reference for an agency, without a run', async () => {
    const rows = [{ key: 'billing.check-severity', kind: 'lookup', definition: {} }];
    const { db, queries } = createRecordingDb(() => rows);
    assert.deepEqual(await findGraphTables(db, 't-1', []), []);
    assert.equal(queries.length, 0);
    assert.deepEqual(await findGraphTables(db, 't-1', ['v-1', 'v-2']), rows);
    assert.match(flat(queries[0]?.sql ?? ''), /jsonb_path_query\(gv\.definition/);
    assert.ok(queries[0]?.parameters.some((p) => Array.isArray(p) && p.includes('v-2')));
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
