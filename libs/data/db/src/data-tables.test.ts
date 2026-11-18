import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type CompiledQuery, sql } from 'kysely';
import {
  AGENCY_TABLE_PREFIX,
  buildCopyRunTables,
  buildPinRunTables,
  findTableDefinitions,
  resolvedTable
} from './data-tables.ts';
import { createDummyDb, createRecordingDb } from './testing.ts';

const flat = (q: CompiledQuery | undefined) => q?.sql.replace(/\s+/g, ' ').trim();

const TABLE_KEYS_PATH =
  '$.nodes[*] ? (@.type == "std.table.decide" || @.type == "std.table.lookup").config.table.key';

const resolvedSql = (key: string, agency: string) =>
  `( select v.id from data_tables t join data_table_versions v on v.table_id = t.id left join lateral ( select sv.contract from data_tables st join data_table_versions sv on sv.table_id = st.id where st.key = t.key and st.agency_id is null and sv.published_at is not null order by sv.version desc limit 1 ) base on true where t.key = ${key} and t.is_active and v.published_at is not null and ( t.agency_id is null or ( t.agency_id = ${agency}::uuid and (base.contract is null or v.contract = base.contract) ) ) order by t.agency_id is null, v.version desc limit 1 )`;

const pinSql = (pinned: string) =>
  `insert into workflow_run_tables (run_id, key, table_version_id) select $1::uuid, k.key, r.id from ( select distinct jsonb_path_query(gv.definition, $2::jsonpath) #>> '{}' as key from workflow_run_graphs g join graph_versions gv on gv.id = g.graph_version_id where g.run_id = $3::uuid ) k cross join lateral (select ${pinned} as id) r where r.id is not null on conflict do nothing`;

describe('resolvedTable', () => {
  it('resolves a system table, or an agency table matching the system contract, newest first', async () => {
    const db = createDummyDb();
    const key = `${AGENCY_TABLE_PREFIX}region-reasons`;
    const compiled = sql`select ${resolvedTable('t-1', sql`${key}`)}`.compile(db);
    assert.equal(flat(compiled), `select ${resolvedSql('$1', '$2')}`);
    assert.deepEqual(compiled.parameters, ['agency.region-reasons', 't-1']);
    await db.destroy();
  });
});

describe('pinning run tables', () => {
  it('pins every table the run graphs reference for the run agency', async () => {
    const db = createDummyDb();
    const own = buildPinRunTables('r-1', 't-2', null).compile(db);
    assert.equal(flat(own), pinSql(resolvedSql('"k"."key"', '$4')));
    assert.deepEqual(own.parameters, ['r-1', TABLE_KEYS_PATH, 'r-1', 't-2']);
    await db.destroy();
  });

  it('reuses the parent run pins before resolving afresh', async () => {
    const db = createDummyDb();
    const child = buildPinRunTables('r-2', 't-1', 'p-1').compile(db);
    assert.equal(
      flat(child),
      pinSql(
        `coalesce( ( select p.table_version_id from workflow_run_tables p where p.run_id = $4::uuid and p.key = k.key ), ${resolvedSql('"k"."key"', '$5')} )`
      )
    );
    assert.deepEqual(child.parameters, ['r-2', TABLE_KEYS_PATH, 'r-2', 'p-1', 't-1']);
    await db.destroy();
  });

  it('copies the tables of one run to the others', async () => {
    const db = createDummyDb();
    const copy = buildCopyRunTables('r-1', ['r-2', 'r-3']).compile(db);
    assert.equal(
      flat(copy),
      'insert into workflow_run_tables (run_id, key, table_version_id) select t.id, p.key, p.table_version_id from workflow_run_tables p cross join unnest($1::uuid[]) as t (id) where p.run_id = $2::uuid on conflict do nothing'
    );
    assert.deepEqual(copy.parameters, [['r-2', 'r-3'], 'r-1']);
    await db.destroy();
  });
});

describe('findTableDefinitions', () => {
  it('loads pinned table definitions with their kind, each once', async () => {
    const rows = [
      { id: 'tv-1', kind: 'decide', definition: {} },
      { id: 'tv-2', kind: 'lookup', definition: {} }
    ];
    const { db, queries } = createRecordingDb(() => rows);
    assert.deepEqual(await findTableDefinitions(db, ['tv-1', 'tv-1', 'tv-2']), rows);
    assert.equal(
      queries[0]?.sql,
      'select "v"."id", "t"."kind", "v"."definition" from "data_table_versions" as "v" inner join "data_tables" as "t" on "t"."id" = "v"."table_id" where "v"."id" in ($1, $2)'
    );
    assert.deepEqual(queries[0]?.parameters, ['tv-1', 'tv-2']);
    await db.destroy();
  });

  it('reads nothing for no ids', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'tv-1' }]);
    assert.deepEqual(await findTableDefinitions(db, []), []);
    assert.equal(queries.length, 0);
    await db.destroy();
  });
});
