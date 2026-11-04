import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { type Json, tableContract } from '@ugula/graph';
import type { CompiledQuery } from 'kysely';
import type { Scope } from '../../shared/scopes.ts';
import { testAccess } from '../../shared/testing.ts';
import { createTableService, tableIssues } from './service.ts';

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
  rules: []
};

type Table = { id: string; scope: Scope; active?: boolean };
type Version = {
  id: string;
  version: number;
  definition: Json;
  published?: boolean;
  base?: string;
};

const createWorld = (tables: Table[], versions: Record<string, Version[]> = {}) => {
  const live = tables.filter((t) => t.active !== false);
  const of = (id: unknown) => versions[id as string] ?? [];
  const rows = (q: CompiledQuery): unknown[] => {
    const [p0, p1] = q.parameters;
    const sql = q.sql;
    if (sql.startsWith('select "t"."id", "t"."key"')) {
      const t = live.find((x) => x.id === q.parameters[4]);
      return t
        ? [
            {
              id: t.id,
              key: 'billing.base-rate',
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
    if (sql.startsWith('select "t"."id", case')) {
      const order = { agency: 0, organization: 1, system: 2 };
      const [t] = live.toSorted((a, b) => order[a.scope] - order[b.scope]);
      return t ? [{ id: t.id, scope: t.scope }] : [];
    }
    if (sql.startsWith('select "id", "is_active" from "data_tables"')) {
      const scope = q.parameters.length === 2 ? 'organization' : 'agency';
      const t = tables.find((x) => x.scope === scope);
      return t ? [{ id: t.id, is_active: t.active !== false }] : [];
    }
    if (sql.startsWith('select "id" from "data_tables"')) {
      const t = tables.find((x) => x.scope === 'system');
      return t ? [{ id: t.id }] : [];
    }
    if (sql.startsWith('select "id", "version", "definition", "contract"')) {
      const [v] = of(p0)
        .filter((x) => x.published)
        .toSorted((a, b) => b.version - a.version);
      return v ? [{ ...v, contract: tableContract(v.definition) }] : [];
    }
    if (sql.includes('for update')) {
      const v = of(p0).find((x) => !x.published);
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
    if (sql.startsWith('select "v"."id", "v"."version", "v"."definition"')) {
      for (const [tableId, list] of Object.entries(versions)) {
        const v = list.find((x) => x.id === p0);
        const t = tables.find((x) => x.id === tableId);
        if (v && t) return [{ ...v, table_id: t.id, scope: t.scope }];
      }
      return [];
    }
    if (sql.includes('max("version")')) {
      return [{ max: Math.max(0, ...of(p0).map((v) => v.version)) }];
    }
    if (sql.startsWith('insert into "data_tables"')) return [{ id: 't-new' }];
    if (sql.startsWith('insert into "data_table_versions"')) return [{ id: 'v-new', version: p1 }];
    if (sql.startsWith('update "data_tables" set "is_active"')) return [{ id: p1 }];
    return [];
  };
  const { db, queries } = createRecordingDb(rows);
  const find = (prefix: string) => queries.filter((q) => q.sql.startsWith(prefix));
  return { service: createTableService({ db }), find };
};

const system: Table = { id: 't-sys', scope: 'system' };
const agency: Table = { id: 't-agency', scope: 'agency' };
const sysV: Version = { id: 'v-sys', version: 1, definition: RATES, published: true };

describe('tableIssues', () => {
  it('checks a definition against its kind', () => {
    assert.deepEqual(tableIssues('decide', RATES), []);
    assert.ok(tableIssues('lookup', { rows: 'x' }).length > 0);
  });
});

describe('table service', () => {
  it('lets workflows:update override tables for the agency and owners for the organization', async () => {
    const { service } = createWorld([system], { 't-sys': [sysV] });
    const found = await service.find(editor, 't-sys');
    assert.ok(found.ok);
    assert.equal(found.value.table.canEdit, false);
    assert.deepEqual(found.value.table.canOverride, { organization: false, agency: true });
    const asReader = await service.find(reader, 't-sys');
    assert.ok(asReader.ok);
    assert.deepEqual(asReader.value.table.canOverride, { organization: false, agency: false });
    assert.deepEqual(await service.override(reader, 't-sys', 'agency'), {
      ok: false,
      failure: { code: 'forbidden', message: 'You do not have permission to change this table' }
    });
  });

  it('copies the newest built-in version into a draft that records its base', async () => {
    const { service, find } = createWorld([system], { 't-sys': [sysV] });
    assert.deepEqual(await service.override(editor, 't-sys', 'agency'), {
      ok: true,
      value: { id: 't-new' }
    });
    const [draft] = find('insert into "data_table_versions"');
    assert.deepEqual(draft?.parameters.slice(0, 2), ['t-new', 1]);
    assert.equal(draft?.parameters[4], 'v-sys');
    const owners = createWorld([system], { 't-sys': [sysV] });
    assert.equal((await owners.service.override(editor, 't-sys', 'organization')).ok, false);
    assert.equal((await owners.service.override(admin, 't-sys', 'organization')).ok, true);
  });

  it('saves only valid drafts and publishes only drafts that keep the built-in fields', async () => {
    const versions = (definition: Json) => ({
      't-sys': [sysV],
      't-agency': [{ id: 'd1', version: 1, definition, base: 'v-sys' }]
    });
    const world = createWorld([system, agency], versions(RATES));
    assert.deepEqual(await world.service.saveDraft(editor, 't-agency', RATES), {
      ok: true,
      value: { version: 1 }
    });
    const bad = await world.service.saveDraft(editor, 't-agency', { inputs: 1 });
    assert.equal(!bad.ok && bad.failure.code, 'invalid');
    assert.deepEqual(await world.service.publish(editor, 't-agency'), {
      ok: true,
      value: { version: 1 }
    });
    assert.equal(world.find('update "data_table_versions" set "published_at"').length, 1);
    const drifted = createWorld([system, agency], versions(WIDER));
    assert.deepEqual(await drifted.service.publish(editor, 't-agency'), {
      ok: false,
      failure: {
        code: 'invalid',
        message: 'An override must keep the inputs and outputs of the built-in table it replaces'
      }
    });
    assert.deepEqual(await world.service.saveDraft(editor, 't-sys', RATES), {
      ok: false,
      failure: { code: 'forbidden', message: 'Built-in tables are read-only' }
    });
  });

  it('compares an override with the version it copied and the newest built-in', async () => {
    const { service } = createWorld([system, agency], {
      't-sys': [sysV, { ...sysV, id: 'v-sys-2', version: 2, definition: WIDER }],
      't-agency': [{ id: 'a1', version: 1, definition: RATES, published: true, base: 'v-sys' }]
    });
    const res = await service.compare(admin, 't-agency');
    assert.ok(res.ok);
    assert.equal(res.value.copiedFrom?.tableId, 't-sys');
    assert.equal(res.value.latest?.version, 2);
    assert.equal(res.value.baseChanged, true);
    const builtIn = await service.compare(admin, 't-sys');
    assert.ok(builtIn.ok && builtIn.value.mine === null);
  });

  it('turns an override off and reads versions of visible tables only', async () => {
    const { service, find } = createWorld([system, agency], {
      't-agency': [{ id: 'a1', version: 1, definition: RATES, published: true }]
    });
    assert.deepEqual(await service.remove(editor, 't-agency'), {
      ok: true,
      value: { id: 't-agency' }
    });
    assert.deepEqual(find('update "data_tables" set "is_active"')[0]?.parameters, [
      false,
      't-agency'
    ]);
    assert.equal((await service.version(admin, 't-agency', 1)).ok, true);
    assert.equal((await service.version(admin, 't-nope', 1)).ok, false);
  });
});
