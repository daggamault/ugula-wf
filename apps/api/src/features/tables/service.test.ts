import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { type Json, tableContract } from '@ugula/graph';
import type { CompiledQuery } from 'kysely';
import type { Scope } from '../../shared/scopes.ts';
import { testAccess } from '../../shared/testing.ts';
import type { NewTable } from './schemas.ts';
import { createTableService, isAgencyDefined, tableIssues } from './service.ts';

const admin = testAccess();
const editor = testAccess(['workflows:read', 'workflows:update']);
const reader = testAccess(['workflows:read']);

const RATES: Json = {
  inputs: [{ name: 'level', type: 'string' }],
  outputs: [{ name: 'code', type: 'string' }],
  rules: [{ label: 'ALS2', when: { level: { op: 'is', value: 'ALS2' } }, set: { code: 'A0433' } }],
  otherwise: { code: 'A0428' }
};

const WIDER: Json = {
  ...(RATES as object),
  outputs: [{ name: 'other', type: 'string' }],
  rules: [],
  otherwise: {}
};

const NO_RULES: Json = { inputs: [], outputs: [] };

const NO_RULES_ISSUE = 'Invalid key: Expected "rules" but received undefined';

const BASE_RATE = 'billing.base-rate';

type Table = { id: string; scope: Scope; key?: string; active?: boolean };
type Version = {
  id: string;
  version: number;
  definition: Json;
  published?: boolean;
  base?: string;
};

const failure = (code: string, message: string) => ({ ok: false, failure: { code, message } });

const READ_ONLY = failure('forbidden', 'Standard tables are read-only');
const FORBIDDEN = failure('forbidden', 'You do not have permission to change this table');
const NOT_FOUND = failure('not_found', 'Table not found');

const createWorld = (
  tables: Table[],
  versions: Record<string, Version[]> = {},
  insertError?: Error
) => {
  const keyOf = (t: Table) => t.key ?? BASE_RATE;
  const live = tables.filter((t) => t.active !== false);
  const of = (id: unknown) => versions[id as string] ?? [];
  const rows = (q: CompiledQuery): unknown[] => {
    const [p0, p1] = q.parameters;
    const sql = q.sql;
    if (sql.startsWith('select "t"."id", "t"."key"')) {
      const t = live.find((x) => x.id === q.parameters.at(-2));
      return t
        ? [
            {
              id: t.id,
              key: keyOf(t),
              name: 'Base Rate',
              kind: 'decide',
              description: '',
              scope: t.scope,
              overrides: null,
              overridden_by: null,
              is_stale: false
            }
          ]
        : [];
    }
    if (sql.startsWith('select "t"."id" as "id", case')) {
      const order = { agency: 0, system: 1 };
      const [t] = live.toSorted((a, b) => order[a.scope] - order[b.scope]);
      return t ? [{ id: t.id, scope: t.scope }] : [];
    }
    if (sql.startsWith('select "id", "is_active" from "data_tables"')) {
      const t = tables.find((x) => x.scope === 'agency' && keyOf(x) === p1);
      return t ? [{ id: t.id, is_active: t.active !== false }] : [];
    }
    if (sql.startsWith('select "id" from "data_tables" where "key"')) {
      const t = tables.find((x) => x.scope === 'system' && keyOf(x) === p0);
      return t ? [{ id: t.id }] : [];
    }
    if (sql.startsWith('select "id", "version", "definition", "contract"')) {
      const [v] = of(p0)
        .filter((x) => x.published)
        .toSorted((a, b) => b.version - a.version);
      return v ? [{ ...v, contract: tableContract(v.definition) }] : [];
    }
    if (sql.startsWith('select "id", "version", "definition", "base_version_id"')) {
      const candidates = sql.includes('for update') ? of(p0).filter((x) => !x.published) : of(p0);
      const [v] = candidates.toSorted((a, b) => b.version - a.version);
      return v ? [{ ...v, base_version_id: v.base ?? null }] : [];
    }
    if (sql.includes('"base_table_id"')) {
      return of(p0)
        .toSorted((a, b) => b.version - a.version)
        .map((v) => ({ id: v.id, version: v.version }));
    }
    if (sql.startsWith('select "id", "version", "definition", "published_at"')) {
      const v = of(p0).find((x) => x.version === p1);
      return v ? [{ ...v, base_version_id: v.base ?? null }] : [];
    }
    if (sql.trimStart().startsWith('select v.id, v.version, v.definition')) {
      for (const [tableId, list] of Object.entries(versions)) {
        const v = list.find((x) => x.id === p0);
        const t = tables.find((x) => x.id === tableId);
        if (v && t) return [{ ...v, owner_id: t.id, scope: t.scope }];
      }
      return [];
    }
    if (sql.includes('max("version")')) {
      return [{ max: Math.max(0, ...of(p0).map((v) => v.version)) }];
    }
    if (sql.startsWith('insert into "data_tables"')) {
      if (insertError) throw insertError;
      return [{ id: 't-new' }];
    }
    if (sql.startsWith('insert into "data_table_versions"')) return [{ id: 'v-new', version: p1 }];
    if (sql.startsWith('update "data_tables" set "is_active"')) {
      return live.some((t) => t.id === p1 && t.scope === 'agency') ? [{ id: p1 }] : [];
    }
    return [];
  };
  const { db, queries } = createRecordingDb(rows);
  const find = (prefix: string) => queries.filter((q) => q.sql.startsWith(prefix));
  return { service: createTableService({ db }), find, queries };
};

const system: Table = { id: 't-sys', scope: 'system' };
const agency: Table = { id: 't-agency', scope: 'agency' };
const custom: Table = { id: 't-custom', scope: 'agency', key: 'agency.mileage' };
const sysV: Version = { id: 'v-sys', version: 1, definition: RATES, published: true };

const newTable = (definition: unknown): NewTable => ({
  name: 'Codes',
  kind: 'decide',
  description: '',
  definition
});

describe('tableIssues', () => {
  it('accepts a definition that matches its kind', () => {
    assert.deepEqual(tableIssues('decide', RATES), []);
    assert.deepEqual(
      tableIssues('lookup', { type: 'string', rows: [{ key: 'a', value: 'A' }] }),
      []
    );
  });

  it('lists every issue with a definition that does not match its kind', () => {
    assert.deepEqual(tableIssues('lookup', { rows: 'x' }), [
      'Invalid type: Expected Array but received "x"'
    ]);
    assert.deepEqual(tableIssues('decide', { inputs: 1 }), [
      'Invalid type: Expected Array but received 1',
      'Invalid key: Expected "outputs" but received undefined',
      NO_RULES_ISSUE
    ]);
  });
});

describe('isAgencyDefined', () => {
  it('marks only agency tables under the agency prefix', () => {
    assert.equal(isAgencyDefined({ key: 'agency.mileage', scope: 'agency' }), true);
    assert.equal(isAgencyDefined({ key: BASE_RATE, scope: 'agency' }), false);
    assert.equal(isAgencyDefined({ key: 'agency.mileage', scope: 'system' }), false);
  });
});

describe('table service', () => {
  it('searches and lists effective tables in the agency scope', async () => {
    const { service, queries } = createWorld([]);
    const filters = {
      kind: [],
      scope: [],
      page: 1,
      pageSize: 25,
      sort: 'name',
      dir: 'asc'
    } as const;
    assert.deepEqual(await service.search(admin, filters), {
      ok: true,
      value: { items: [], total: 0, page: 1, pageSize: 25, facets: { kind: [], scope: [] } }
    });
    assert.deepEqual(await service.effective(admin), { ok: true, value: { tables: [] } });
    assert.deepEqual(
      queries.map((q) => q.parameters.includes('t-1')),
      [true, true, true, true]
    );
  });

  it('describes a standard table that an editor may override but not edit', async () => {
    const { service } = createWorld([system], { 't-sys': [sysV] });
    assert.deepEqual(await service.find(editor, 't-sys'), {
      ok: true,
      value: {
        table: {
          id: 't-sys',
          key: BASE_RATE,
          name: 'Base Rate',
          kind: 'decide',
          description: '',
          scope: 'system',
          overrides: null,
          overridden_by: null,
          is_stale: false,
          canEdit: false,
          canOverride: true,
          isAgencyDefined: false,
          effectiveId: 't-sys',
          effectiveScope: 'system'
        },
        versions: [{ id: 'v-sys', version: 1 }]
      }
    });
    const asReader = await service.find(reader, 't-sys');
    assert.equal(asReader.ok && asReader.value.table.canOverride, false);
  });

  it('points a standard table at the agency override that replaces it', async () => {
    const { service } = createWorld([system, agency]);
    const res = await service.find(editor, 't-sys');
    assert.ok(res.ok);
    const { effectiveId, effectiveScope } = res.value.table;
    assert.deepEqual(
      { effectiveId, effectiveScope },
      { effectiveId: 't-agency', effectiveScope: 'agency' }
    );
  });

  it('lets an editor edit an agency-defined table', async () => {
    const { service } = createWorld([custom]);
    const res = await service.find(editor, 't-custom');
    assert.ok(res.ok);
    const { canEdit, canOverride, isAgencyDefined } = res.value.table;
    assert.deepEqual(
      { canEdit, canOverride, isAgencyDefined },
      { canEdit: true, canOverride: false, isAgencyDefined: true }
    );
  });

  it('reports a table outside the agency as not found', async () => {
    const { service } = createWorld([system]);
    assert.deepEqual(await service.find(admin, 't-other'), NOT_FOUND);
    assert.deepEqual(await service.compare(admin, 't-other'), NOT_FOUND);
  });

  it('reads a version only of a visible table', async () => {
    const { service } = createWorld([system, agency], {
      't-agency': [{ id: 'a1', version: 1, definition: RATES, published: true }]
    });
    assert.deepEqual(await service.version(admin, 't-agency', 1), {
      ok: true,
      value: { id: 'a1', version: 1, definition: RATES, published: true, base_version_id: null }
    });
    const missing = failure('not_found', 'Version not found');
    assert.deepEqual(await service.version(admin, 't-agency', 2), missing);
    assert.deepEqual(await service.version(admin, 't-nope', 1), missing);
  });

  it('compares an override with the version it copied and the newest standard', async () => {
    const { service } = createWorld([system, agency], {
      't-sys': [sysV, { ...sysV, id: 'v-sys-2', version: 2, definition: WIDER }],
      't-agency': [{ id: 'a1', version: 1, definition: RATES, published: true, base: 'v-sys' }]
    });
    assert.deepEqual(await service.compare(admin, 't-agency'), {
      ok: true,
      value: {
        mine: { version: 1, definition: RATES },
        copiedFrom: { tableId: 't-sys', scope: 'system', version: 1, definition: RATES },
        latest: { version: 2, definition: WIDER },
        baseChanged: true
      }
    });
  });

  it('compares nothing for a standard table and only itself for an agency-defined one', async () => {
    const empty = { mine: null, copiedFrom: null, latest: null, baseChanged: false };
    const { service } = createWorld([system, custom], {
      't-custom': [{ id: 'c1', version: 1, definition: RATES }]
    });
    assert.deepEqual(await service.compare(admin, 't-sys'), { ok: true, value: empty });
    assert.deepEqual(await service.compare(admin, 't-custom'), {
      ok: true,
      value: { ...empty, mine: { version: 1, definition: RATES } }
    });
  });

  it('creates an agency table under a key from its name with a first draft', async () => {
    const { service, find } = createWorld([]);
    assert.deepEqual(
      await service.create(editor, {
        name: 'Mileage Rates!',
        kind: 'decide',
        description: 'Per mile',
        definition: RATES
      }),
      { ok: true, value: { id: 't-new', key: 'agency.mileage-rates' } }
    );
    assert.deepEqual(find('insert into "data_tables"')[0]?.parameters, [
      't-1',
      'agency.mileage-rates',
      'Mileage Rates!',
      'decide',
      'Per mile'
    ]);
    assert.deepEqual(find('insert into "data_table_versions"')[0]?.parameters, [
      't-new',
      1,
      JSON.stringify(RATES),
      tableContract(RATES),
      null,
      'u-1'
    ]);
  });

  it('refuses to create a table without permission or with an invalid definition', async () => {
    const { service, queries } = createWorld([]);
    assert.deepEqual(await service.create(reader, newTable(RATES)), FORBIDDEN);
    assert.deepEqual(
      await service.create(editor, newTable(NO_RULES)),
      failure('invalid', NO_RULES_ISSUE)
    );
    assert.equal(queries.length, 0);
  });

  it('refuses a table name the agency already used', async () => {
    const dup = Object.assign(new Error('duplicate'), { code: '23505' });
    const { service } = createWorld([], {}, dup);
    assert.deepEqual(
      await service.create(editor, newTable(RATES)),
      failure('conflict', 'Your agency already has or had a table with that name')
    );
  });

  it('rethrows other errors while creating a table', async () => {
    const boom = new Error('connection lost');
    const { service } = createWorld([], {}, boom);
    await assert.rejects(service.create(editor, newTable(RATES)), boom);
  });

  it('copies the newest standard version into a draft that records its base', async () => {
    const { service, find } = createWorld([system], {
      't-sys': [sysV, { id: 'v-sys-0', version: 0, definition: WIDER, published: true }]
    });
    assert.deepEqual(await service.override(editor, 't-sys'), { ok: true, value: { id: 't-new' } });
    assert.deepEqual(find('insert into "data_tables"')[0]?.parameters, [
      't-1',
      BASE_RATE,
      'Base Rate',
      'decide',
      ''
    ]);
    assert.deepEqual(find('insert into "data_table_versions"')[0]?.parameters, [
      't-new',
      1,
      JSON.stringify(RATES),
      tableContract(RATES),
      'v-sys',
      'u-1'
    ]);
  });

  it('refuses to override without permission, an unknown table or an agency table', async () => {
    const { service } = createWorld([system, custom], { 't-sys': [sysV] });
    assert.deepEqual(await service.override(reader, 't-sys'), FORBIDDEN);
    assert.deepEqual(await service.override(editor, 't-other'), NOT_FOUND);
    assert.deepEqual(
      await service.override(editor, 't-custom'),
      failure('conflict', 'This table cannot be overridden for the agency')
    );
  });

  it('updates the open draft in place after locking the table', async () => {
    const { service, find } = createWorld([system, agency], {
      't-sys': [sysV],
      't-agency': [{ id: 'd1', version: 3, definition: RATES, base: 'v-sys' }]
    });
    assert.deepEqual(await service.saveDraft(editor, 't-agency', RATES), {
      ok: true,
      value: { version: 3 }
    });
    assert.deepEqual(
      find('select "id" from "data_tables" where "id" = $1 for update')[0]?.parameters,
      ['t-agency']
    );
    assert.deepEqual(find('update "data_table_versions" set "definition"')[0]?.parameters, [
      JSON.stringify(RATES),
      tableContract(RATES),
      'd1'
    ]);
    assert.equal(find('insert into "data_table_versions"').length, 0);
    assert.deepEqual(find('update "data_tables" set "updated_at"')[0]?.parameters, ['t-agency']);
  });

  it('opens the next version as a draft based on the newest standard', async () => {
    const { service, find } = createWorld([system, agency], {
      't-sys': [sysV],
      't-agency': [{ id: 'a1', version: 2, definition: RATES, published: true, base: 'v-sys' }]
    });
    assert.deepEqual(await service.saveDraft(editor, 't-agency', RATES), {
      ok: true,
      value: { version: 3 }
    });
    assert.deepEqual(find('insert into "data_table_versions"')[0]?.parameters, [
      't-agency',
      3,
      JSON.stringify(RATES),
      tableContract(RATES),
      'v-sys',
      'u-1'
    ]);
  });

  it('opens a draft with no base for an agency-defined table', async () => {
    const { service, find } = createWorld([custom], {
      't-custom': [{ id: 'c1', version: 1, definition: RATES, published: true }]
    });
    assert.deepEqual(await service.saveDraft(editor, 't-custom', RATES), {
      ok: true,
      value: { version: 2 }
    });
    assert.equal(find('insert into "data_table_versions"')[0]?.parameters[4], null);
  });

  it('refuses drafts that are invalid, standard, unknown or not permitted', async () => {
    const { service, find } = createWorld([system, agency]);
    assert.deepEqual(
      await service.saveDraft(editor, 't-agency', NO_RULES),
      failure('invalid', NO_RULES_ISSUE)
    );
    assert.deepEqual(await service.saveDraft(editor, 't-sys', RATES), READ_ONLY);
    assert.deepEqual(await service.saveDraft(editor, 't-other', RATES), NOT_FOUND);
    assert.deepEqual(await service.saveDraft(reader, 't-agency', RATES), FORBIDDEN);
    assert.equal(find('insert into "data_table_versions"').length, 0);
    assert.equal(find('update "data_table_versions"').length, 0);
  });

  it('publishes a draft that keeps the standard inputs and outputs', async () => {
    const { service, find } = createWorld([system, agency], {
      't-sys': [sysV],
      't-agency': [{ id: 'd1', version: 2, definition: RATES, base: 'v-sys' }]
    });
    assert.deepEqual(await service.publish(editor, 't-agency'), {
      ok: true,
      value: { version: 2 }
    });
    assert.deepEqual(find('update "data_table_versions" set "published_at"')[0]?.parameters, [
      'd1'
    ]);
    assert.deepEqual(find('update "data_tables" set "updated_at"')[0]?.parameters, ['t-agency']);
  });

  it('publishes an agency-defined table without comparing it to a standard', async () => {
    const { service } = createWorld([custom], {
      't-custom': [{ id: 'c1', version: 1, definition: WIDER }]
    });
    assert.deepEqual(await service.publish(editor, 't-custom'), {
      ok: true,
      value: { version: 1 }
    });
  });

  it('refuses to publish an override that changes the standard inputs or outputs', async () => {
    const { service, find } = createWorld([system, agency], {
      't-sys': [sysV],
      't-agency': [{ id: 'd1', version: 2, definition: WIDER, base: 'v-sys' }]
    });
    assert.deepEqual(
      await service.publish(editor, 't-agency'),
      failure(
        'invalid',
        'An override must keep the inputs and outputs of the standard table it replaces'
      )
    );
    assert.equal(find('update "data_table_versions"').length, 0);
  });

  it('refuses to publish without a draft or with an invalid draft', async () => {
    const empty = createWorld([agency], {
      't-agency': [{ id: 'a1', version: 1, definition: RATES, published: true }]
    });
    assert.deepEqual(
      await empty.service.publish(editor, 't-agency'),
      failure('conflict', 'Nothing to publish')
    );
    const broken = createWorld([agency], {
      't-agency': [{ id: 'd1', version: 1, definition: NO_RULES }]
    });
    assert.deepEqual(
      await broken.service.publish(editor, 't-agency'),
      failure('invalid', NO_RULES_ISSUE)
    );
  });

  it('refuses to publish a standard, unknown or not permitted table', async () => {
    const { service } = createWorld([system, agency]);
    assert.deepEqual(await service.publish(editor, 't-sys'), READ_ONLY);
    assert.deepEqual(await service.publish(editor, 't-other'), NOT_FOUND);
    assert.deepEqual(await service.publish(reader, 't-agency'), FORBIDDEN);
  });

  it('turns an agency table off', async () => {
    const { service, find } = createWorld([system, agency]);
    assert.deepEqual(await service.remove(editor, 't-agency'), {
      ok: true,
      value: { id: 't-agency' }
    });
    assert.deepEqual(find('update "data_tables" set "is_active"')[0]?.parameters, [
      false,
      't-agency'
    ]);
  });

  it('refuses to turn off a standard, unknown or not permitted table', async () => {
    const { service, find } = createWorld([system, agency]);
    assert.deepEqual(await service.remove(editor, 't-sys'), READ_ONLY);
    assert.deepEqual(await service.remove(editor, 't-other'), NOT_FOUND);
    assert.deepEqual(await service.remove(reader, 't-agency'), FORBIDDEN);
    assert.equal(find('update "data_tables" set "is_active"').length, 0);
  });
});
