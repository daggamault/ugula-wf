import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb, createRecordingDb } from '@ugula/db/testing';
import { sql } from 'kysely';
import {
  buildEffective,
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
  nextVersionOf,
  overriddenByIn,
  overridesIn,
  ownerOf,
  scopeIds,
  setActive,
  touch
} from './scopes.ts';
import { testAccess } from './testing.ts';

const admin = testAccess();
const editor = testAccess(['workflows:read', 'workflows:update']);
const manager = testAccess(['workflows:read', 'workflows:update', 'workflows:manage']);
const reader = testAccess(['workflows:read']);

const flat = (text: string) => text.replace(/\s+/g, ' ');

describe('canEditScope', () => {
  it('never edits built-ins, leaves organization copies to owners and agency copies to permissions', () => {
    assert.equal(canEditScope(admin, 'system', 'workflow'), false);
    assert.equal(canEditScope(admin, 'organization', 'workflow'), true);
    assert.equal(canEditScope(manager, 'organization', 'rule'), false);
    assert.equal(canEditScope(manager, 'agency', 'workflow'), true);
    assert.equal(canEditScope(reader, 'agency', 'rule'), false);
  });

  it('lets workflows:update change rules, slots and tables and keeps stages and workflows to manage', () => {
    for (const tier of ['rule', 'slot', 'table'] as const) {
      assert.equal(canEditScope(editor, 'agency', tier), true, tier);
    }
    for (const tier of ['stage', 'workflow'] as const) {
      assert.equal(canEditScope(editor, 'agency', tier), false, tier);
      assert.equal(canEditScope(manager, 'agency', tier), true, tier);
    }
  });
});

describe('scope helpers', () => {
  it('names the agency and owner a copy belongs to', () => {
    assert.deepEqual(scopeIds(admin), { agencyId: 't-1', organizationId: 'o-1' });
    assert.deepEqual(ownerOf(admin, 'agency'), { organizationId: 'o-1', agencyId: 't-1' });
    assert.deepEqual(ownerOf(admin, 'organization'), { organizationId: 'o-1', agencyId: null });
  });

  it('finds neighbouring scopes and staleness in graphs or tables', async () => {
    const db = createDummyDb();
    const s = { agencyId: 'a-1', organizationId: 'o-1' };
    const above = flat(sql`select ${overriddenByIn('data_tables', 't', s)}`.compile(db).sql);
    assert.ok(above.includes('from "data_tables" o where o.id = ( select ( select ev."table_id"'));
    assert.ok(above.includes('from (select "t"."key" as key) ek'));
    assert.ok(above.includes('where t.key = "ek"."key"'));
    assert.ok(above.includes('end < case when "t"."agency_id"'));
    const graphAbove = flat(sql`select ${overriddenByIn('graphs', 'g', s)}`.compile(db).sql);
    assert.ok(graphAbove.includes('select ev."graph_id" from "graph_versions" ev'));
    assert.ok(graphAbove.includes('from (select "g"."key" as key) ek'));
    const below = flat(sql`select ${overridesIn('graphs', 'g', s)}`.compile(db).sql);
    assert.ok(below.includes('from "graphs" o') && below.includes('end > case'));
    const stale = flat(sql`select ${isStaleIn('data_tables', 't')}`.compile(db).sql);
    assert.ok(stale.includes('from "data_table_versions" sv where sv."table_id" = sg.id'));
    assert.ok(stale.includes('mv."table_id" = "t"."id"'));
    const effective = flat(buildEffective('data_tables', s).compile(db).sql);
    assert.ok(effective.includes('from (select distinct k.key from "data_tables" k where'));
    assert.ok(effective.includes('join "data_tables" e on e.id = ( select ( select ev."table_id"'));
    await db.destroy();
  });

  it('finds the graph or table in effect for a key as runs resolve it', async () => {
    const { db, queries } = createRecordingDb();
    await findEffectiveIn(db, 'graphs', { agencyId: 'a-1', organizationId: 'o-1' }, 'acme.flow');
    await findEffectiveIn(db, 'data_tables', { agencyId: 'a-1', organizationId: 'o-1' }, 'k');
    const [graph, table] = queries;
    assert.ok(graph?.sql.startsWith('select "g"."id" as "id", case'));
    assert.ok(flat(graph?.sql ?? '').includes('from (select $8::text as key) ek'));
    assert.equal(graph?.parameters.at(-1), 'acme.flow');
    assert.ok(table?.sql.startsWith('select "t"."id" as "id", case'));
    assert.ok(
      flat(table?.sql ?? '').includes('select ev."table_id" from "data_table_versions" ev')
    );
    await db.destroy();
  });
});

describe('scoped queries', () => {
  it('reads and changes copies of graphs or tables by the same queries', async () => {
    const { db, queries } = createRecordingDb();
    await findScoped(db, 'graphs', { organizationId: 'o-1', agencyId: null }, 'acme.flow');
    await findScoped(db, 'data_tables', { organizationId: 'o-1', agencyId: 'a-1' }, 'acme.t');
    await findSystem(db, 'graphs', 'acme.flow');
    await setActive(db, 'data_tables', 't1', false);
    await touch(db, 'graphs', 'g1');
    const [org, agency, system, toggle, touched] = queries;
    assert.ok(
      org?.sql.endsWith(
        'from "graphs" where "organization_id" = $1 and "agency_id" is null and "key" = $2'
      )
    );
    assert.ok(agency?.sql.includes('from "data_tables"'));
    assert.deepEqual(agency?.parameters, ['o-1', 'a-1', 'acme.t']);
    assert.ok(system?.sql.endsWith('where "key" = $1 and "organization_id" is null'));
    assert.ok(toggle?.sql.startsWith('update "data_tables" set "is_active" = $1'));
    assert.ok(toggle?.sql.includes('where "id" = $2 and "organization_id" is not null'));
    assert.deepEqual(toggle?.parameters, [false, 't1']);
    assert.ok(touched?.sql.startsWith('update "graphs" set "updated_at" = now()'));
    await db.destroy();
  });

  it('reads the versions of a graph or a table from its own versions table', async () => {
    const { db, queries } = createRecordingDb((q) => (q.sql.includes('max(') ? [{ max: 4 }] : []));
    await findNewestPublished(db, 'graphs', 'g1');
    await findDraftOf(db, 'data_tables', 't1');
    assert.equal(await nextVersionOf(db, 'data_tables', 't1'), 5);
    await findVersionOf(db, 'graphs', 'g1', 2);
    await findHeadVersion(db, 'data_tables', 't1');
    await findVersionById(db, 'data_tables', 'v1');
    const [newest, draft, next, one, head, byId] = queries;
    assert.ok(newest?.sql.includes('from "graph_versions" where "graph_id" = $1'));
    assert.ok(newest?.sql.endsWith('"published_at" is not null order by "version" desc limit $2'));
    assert.ok(draft?.sql.includes('from "data_table_versions" where "table_id" = $1'));
    assert.ok(draft?.sql.endsWith('"published_at" is null for update'));
    assert.ok(next?.sql.includes('max("version")'));
    assert.deepEqual(one?.parameters, ['g1', 2]);
    assert.ok(head?.sql.endsWith('order by "version" desc limit $2'));
    const joined = flat(byId?.sql ?? '');
    assert.ok(
      joined.includes('from "data_table_versions" v join "data_tables" o on o.id = v."table_id"')
    );
    assert.ok(joined.includes('as scope'));
    await db.destroy();
  });
});
