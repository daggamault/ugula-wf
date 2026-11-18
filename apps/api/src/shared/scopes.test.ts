import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb, createRecordingDb } from '@ugula/db/testing';
import { type RawBuilder, sql } from 'kysely';
import {
  canEditScope,
  findDraftOf,
  findEffectiveIn,
  findHeadVersion,
  findNewestPublished,
  findScoped,
  findSystem,
  findVersionById,
  findVersionOf,
  isStaleIn,
  lockOwner,
  nextVersionOf,
  overriddenByIn,
  overridesIn,
  rankOf,
  scopeIds,
  scopeOf,
  setActive,
  touch,
  visible
} from './scopes.ts';
import { testAccess } from './testing.ts';

const admin = testAccess();
const editor = testAccess(['workflows:read', 'workflows:update']);
const manager = testAccess(['workflows:read', 'workflows:update', 'workflows:manage']);
const reader = testAccess(['workflows:read']);

const S = { agencyId: 'a-1' };

const flat = (text: string | undefined) => text?.replace(/\s+/g, ' ').trim();

const compiled = (expr: RawBuilder<unknown>) => {
  const q = sql`select ${expr}`.compile(createDummyDb());
  return [flat(q.sql), q.parameters];
};

describe('canEditScope', () => {
  it('never edits standards', () => {
    for (const tier of ['rule', 'table', 'stage', 'workflow'] as const) {
      assert.equal(canEditScope(admin, 'system', tier), false, tier);
    }
  });

  it('lets workflows:update change agency rules and tables', () => {
    for (const tier of ['rule', 'table'] as const) {
      assert.equal(canEditScope(editor, 'agency', tier), true, tier);
      assert.equal(canEditScope(reader, 'agency', tier), false, tier);
    }
  });

  it('keeps agency stages and workflows to workflows:manage', () => {
    for (const tier of ['stage', 'workflow'] as const) {
      assert.equal(canEditScope(editor, 'agency', tier), false, tier);
      assert.equal(canEditScope(manager, 'agency', tier), true, tier);
      assert.equal(canEditScope(admin, 'agency', tier), true, tier);
    }
  });
});

describe('scope expressions', () => {
  it('names the agency a copy belongs to', () => {
    assert.deepEqual(scopeIds(admin), { agencyId: 't-1' });
  });

  it('calls a row with an agency an agency copy and the rest system', () => {
    assert.deepEqual(compiled(scopeOf('g')), [
      `select case when "g"."agency_id" is not null then 'agency' else 'system' end`,
      []
    ]);
  });

  it('ranks agency copies before system rows', () => {
    assert.deepEqual(compiled(rankOf('g')), [
      'select case when "g"."agency_id" is not null then 0 else 1 end',
      []
    ]);
  });

  it('sees system rows and the agency’s own active copies', () => {
    assert.deepEqual(compiled(visible('g', S)), [
      'select ( "g"."agency_id" is null or ("g"."is_active" and "g"."agency_id" = $1::uuid) )',
      ['a-1']
    ]);
  });

  it('finds the copy in effect above a table row', () => {
    assert.deepEqual(compiled(overriddenByIn('data_tables', 't', S)), [
      'select ( select o.id from "data_tables" o where o.id = ( select ( select ev."table_id" from "data_table_versions" ev where ev.id = ( select v.id from data_tables t join data_table_versions v on v.table_id = t.id left join lateral ( select sv.contract from data_tables st join data_table_versions sv on sv.table_id = st.id where st.key = t.key and st.agency_id is null and sv.published_at is not null order by sv.version desc limit 1 ) base on true where t.key = "ek"."key" and t.is_active and v.published_at is not null and ( t.agency_id is null or ( t.agency_id = $1::uuid and (base.contract is null or v.contract = base.contract) ) ) order by t.agency_id is null, v.version desc limit 1 ) ) from (select "t"."key" as key) ek ) and case when "o"."agency_id" is not null then 0 else 1 end < case when "t"."agency_id" is not null then 0 else 1 end )',
      ['a-1']
    ]);
  });

  it('finds the copy in effect above a graph row through graph versions', () => {
    assert.deepEqual(compiled(overriddenByIn('graphs', 'g', S)), [
      'select ( select o.id from "graphs" o where o.id = ( select ( select ev."graph_id" from "graph_versions" ev where ev.id = ( select v.id from graphs g join graph_versions v on v.graph_id = g.id left join lateral ( select bg.id, bv.contract from graphs bg left join graph_versions bv on bv.graph_id = bg.id and bv.version = ( select v.version from graphs g join graph_versions v on v.graph_id = g.id where g.key = "ek"."key" and g.is_active and v.published_at is not null and ("g"."agency_id" is null or "g"."agency_id" = $1::uuid) order by g.agency_id is not null, v.version desc limit 1) and bv.published_at is not null where bg.key = g.key and bg.agency_id is null ) base on true where g.key = "ek"."key" and g.is_active and v.published_at is not null and ("g"."agency_id" is null or "g"."agency_id" = $2::uuid) and case when base.id is null or base.id = g.id then v.version = ( select v.version from graphs g join graph_versions v on v.graph_id = g.id where g.key = "ek"."key" and g.is_active and v.published_at is not null and ("g"."agency_id" is null or "g"."agency_id" = $3::uuid) order by g.agency_id is not null, v.version desc limit 1) else v.contract = base.contract end order by g.agency_id is null, v.version desc limit 1 ) ) from (select "g"."key" as key) ek ) and case when "o"."agency_id" is not null then 0 else 1 end < case when "g"."agency_id" is not null then 0 else 1 end )',
      ['a-1', 'a-1', 'a-1']
    ]);
  });

  it('finds the nearest visible copy a row overrides', () => {
    assert.deepEqual(compiled(overridesIn('graphs', 'g', S)), [
      'select ( select o.id from "graphs" o where o.key = "g"."key" and ( "o"."agency_id" is null or ("o"."is_active" and "o"."agency_id" = $1::uuid) ) and case when "o"."agency_id" is not null then 0 else 1 end > case when "g"."agency_id" is not null then 0 else 1 end order by case when "o"."agency_id" is not null then 0 else 1 end limit 1 )',
      ['a-1']
    ]);
  });

  it('calls an agency copy stale when the system row published a new contract it lacks', () => {
    assert.deepEqual(compiled(isStaleIn('data_tables', 't')), [
      'select "t"."agency_id" is not null and exists ( select 1 from "data_tables" sg join lateral ( select sv.contract from "data_table_versions" sv where sv."table_id" = sg.id and sv.published_at is not null order by sv.version desc limit 1 ) base on true where sg.key = "t"."key" and sg.agency_id is null and not exists ( select 1 from "data_table_versions" mv where mv."table_id" = "t"."id" and mv.published_at is not null and mv.contract = base.contract ) )',
      []
    ]);
  });
});

describe('effective rows', () => {
  it('finds the graph in effect for a key as runs resolve it', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'g1', scope: 'agency' }]);
    assert.deepEqual(await findEffectiveIn(db, 'graphs', S, 'acme.flow'), {
      id: 'g1',
      scope: 'agency'
    });
    assert.equal(
      flat(queries[0]?.sql),
      `select "g"."id" as "id", case when "g"."agency_id" is not null then 'agency' else 'system' end as "scope" from "graphs" as "g" where "g"."id" = ( select ( select ev."graph_id" from "graph_versions" ev where ev.id = ( select v.id from graphs g join graph_versions v on v.graph_id = g.id left join lateral ( select bg.id, bv.contract from graphs bg left join graph_versions bv on bv.graph_id = bg.id and bv.version = ( select v.version from graphs g join graph_versions v on v.graph_id = g.id where g.key = "ek"."key" and g.is_active and v.published_at is not null and ("g"."agency_id" is null or "g"."agency_id" = $1::uuid) order by g.agency_id is not null, v.version desc limit 1) and bv.published_at is not null where bg.key = g.key and bg.agency_id is null ) base on true where g.key = "ek"."key" and g.is_active and v.published_at is not null and ("g"."agency_id" is null or "g"."agency_id" = $2::uuid) and case when base.id is null or base.id = g.id then v.version = ( select v.version from graphs g join graph_versions v on v.graph_id = g.id where g.key = "ek"."key" and g.is_active and v.published_at is not null and ("g"."agency_id" is null or "g"."agency_id" = $3::uuid) order by g.agency_id is not null, v.version desc limit 1) else v.contract = base.contract end order by g.agency_id is null, v.version desc limit 1 ) ) from (select $4::text as key) ek )`
    );
    assert.deepEqual(queries[0]?.parameters, ['a-1', 'a-1', 'a-1', 'acme.flow']);
  });

  it('finds the table in effect for a key', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findEffectiveIn(db, 'data_tables', S, 'k'), undefined);
    assert.equal(
      flat(queries[0]?.sql),
      `select "t"."id" as "id", case when "t"."agency_id" is not null then 'agency' else 'system' end as "scope" from "data_tables" as "t" where "t"."id" = ( select ( select ev."table_id" from "data_table_versions" ev where ev.id = ( select v.id from data_tables t join data_table_versions v on v.table_id = t.id left join lateral ( select sv.contract from data_tables st join data_table_versions sv on sv.table_id = st.id where st.key = t.key and st.agency_id is null and sv.published_at is not null order by sv.version desc limit 1 ) base on true where t.key = "ek"."key" and t.is_active and v.published_at is not null and ( t.agency_id is null or ( t.agency_id = $1::uuid and (base.contract is null or v.contract = base.contract) ) ) order by t.agency_id is null, v.version desc limit 1 ) ) from (select $2::text as key) ek )`
    );
  });
});

describe('scoped rows', () => {
  it('finds the agency’s own copy of a key', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'g1', is_active: true }]);
    assert.deepEqual(await findScoped(db, 'graphs', S, 'acme.flow'), {
      id: 'g1',
      is_active: true
    });
    await findScoped(db, 'data_tables', S, 'acme.t');
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'select "id", "is_active" from "graphs" where "agency_id" = $1 and "key" = $2',
          ['a-1', 'acme.flow']
        ],
        [
          'select "id", "is_active" from "data_tables" where "agency_id" = $1 and "key" = $2',
          ['a-1', 'acme.t']
        ]
      ]
    );
  });

  it('finds the system row of a key', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'g0' }]);
    assert.deepEqual(await findSystem(db, 'graphs', 'acme.flow'), { id: 'g0' });
    assert.equal(
      queries[0]?.sql,
      'select "id" from "graphs" where "key" = $1 and "agency_id" is null'
    );
    assert.deepEqual(queries[0]?.parameters, ['acme.flow']);
  });

  it('turns only agency copies on or off', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 't1' }]);
    assert.deepEqual(await setActive(db, 'data_tables', 't1', false), { id: 't1' });
    assert.equal(
      queries[0]?.sql,
      'update "data_tables" set "is_active" = $1, "updated_at" = now() where "id" = $2 and "agency_id" is not null returning "id"'
    );
    assert.deepEqual(queries[0]?.parameters, [false, 't1']);
  });

  it('touches and locks a row by id', async () => {
    const { db, queries } = createRecordingDb();
    await touch(db, 'graphs', 'g1');
    await lockOwner(db, 'data_tables', 't1');
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        ['update "graphs" set "updated_at" = now() where "id" = $1', ['g1']],
        ['select "id" from "data_tables" where "id" = $1 for update', ['t1']]
      ]
    );
  });
});

describe('versions', () => {
  it('finds the newest published version of a graph', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'v1' }]);
    assert.deepEqual(await findNewestPublished(db, 'graphs', 'g1'), { id: 'v1' });
    assert.equal(
      queries[0]?.sql,
      'select "id", "version", "definition", "contract" from "graph_versions" where "graph_id" = $1 and "published_at" is not null order by "version" desc limit $2'
    );
    assert.deepEqual(queries[0]?.parameters, ['g1', 1]);
  });

  it('locks the draft of a table', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findDraftOf(db, 'data_tables', 't1'), undefined);
    assert.equal(
      queries[0]?.sql,
      'select "id", "version", "definition", "base_version_id" from "data_table_versions" where "table_id" = $1 and "published_at" is null for update'
    );
    assert.deepEqual(queries[0]?.parameters, ['t1']);
  });

  it('numbers the next version after the highest, starting at 1', async () => {
    const { db, queries } = createRecordingDb(() => [{ max: 4 }]);
    assert.equal(await nextVersionOf(db, 'data_tables', 't1'), 5);
    assert.equal(
      queries[0]?.sql,
      'select max("version") as "max" from "data_table_versions" where "table_id" = $1'
    );
    assert.equal(
      await nextVersionOf(createRecordingDb(() => [{ max: null }]).db, 'graphs', 'g1'),
      1
    );
    assert.equal(await nextVersionOf(createRecordingDb(() => []).db, 'graphs', 'g1'), 1);
  });

  it('finds one version of a graph by number', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await findVersionOf(db, 'graphs', 'g1', 2);
    assert.equal(
      queries[0]?.sql,
      'select "id", "version", "definition", "published_at", "base_version_id" from "graph_versions" where "graph_id" = $1 and "version" = $2'
    );
    assert.deepEqual(queries[0]?.parameters, ['g1', 2]);
  });

  it('finds the head version of a table, published or not', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await findHeadVersion(db, 'data_tables', 't1');
    assert.equal(
      queries[0]?.sql,
      'select "id", "version", "definition", "base_version_id" from "data_table_versions" where "table_id" = $1 order by "version" desc limit $2'
    );
    assert.deepEqual(queries[0]?.parameters, ['t1', 1]);
  });

  it('finds a version by id with its owner and scope', async () => {
    const version = { id: 'v1', version: 1, definition: {}, owner_id: 't1', scope: 'system' };
    const { db, queries } = createRecordingDb(() => [version]);
    assert.deepEqual(await findVersionById(db, 'data_tables', 'v1'), version);
    assert.equal(
      flat(queries[0]?.sql),
      `select v.id, v.version, v.definition, o.id as owner_id, case when "o"."agency_id" is not null then 'agency' else 'system' end as scope from "data_table_versions" v join "data_tables" o on o.id = v."table_id" where v.id = $1::uuid`
    );
    assert.deepEqual(queries[0]?.parameters, ['v1']);
    assert.equal(await findVersionById(createRecordingDb(() => []).db, 'graphs', 'v1'), undefined);
  });
});
