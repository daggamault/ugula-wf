import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db/testing';
import { sql } from 'kysely';
import {
  buildEffective,
  canEditScope,
  isStaleIn,
  overriddenByIn,
  overridesIn,
  ownerOf,
  scopeIds
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
    assert.ok(above.includes('from "data_tables" o where o.key = "t"."key"'));
    assert.ok(above.includes('end < case when "t"."agency_id"'));
    const below = flat(sql`select ${overridesIn('graphs', 'g', s)}`.compile(db).sql);
    assert.ok(below.includes('from "graphs" o') && below.includes('end > case'));
    const stale = flat(sql`select ${isStaleIn('data_tables', 't')}`.compile(db).sql);
    assert.ok(stale.includes('from "data_table_versions" sv where sv."table_id" = sg.id'));
    assert.ok(stale.includes('mv."table_id" = "t"."id"'));
    const effective = flat(buildEffective('data_tables', s).compile(db).sql);
    assert.ok(effective.includes('select distinct on (e.key) e.id, e.key, e.name'));
    assert.ok(effective.includes('from "data_tables" e'));
    await db.destroy();
  });
});
