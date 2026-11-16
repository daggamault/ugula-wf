import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import {
  createGraphSchema,
  definitionSchema,
  rebaseSchema,
  searchGraphsQuery,
  versionParam
} from './schemas.ts';
import { templateFor } from './service.ts';

describe('graph schemas', () => {
  it('normalizes keys, reserves the std namespace and ignores a scope', () => {
    assert.deepEqual(
      v.parse(createGraphSchema, { key: ' Billing.Match-Patient ', name: 'Match', kind: 'node' }),
      {
        key: 'billing.match-patient',
        name: 'Match',
        kind: 'node',
        description: ''
      }
    );
    for (const key of ['std.thing', 'nodot', '1bad.key', 'a..b']) {
      assert.equal(
        v.safeParse(createGraphSchema, { key, name: 'X', kind: 'node' }).success,
        false,
        key
      );
    }
    const base = { key: 'a.b', name: 'X', kind: 'node' };
    assert.ok(!('scope' in v.parse(createGraphSchema, { ...base, scope: 'organization' })));
  });

  it('keeps comment boxes in a saved definition', () => {
    const definition = {
      ...templateFor('workflow'),
      comments: [{ id: 'c1', text: 'Why', position: { x: 1, y: 2 }, size: { width: 3, height: 4 } }]
    };
    assert.deepEqual(v.parse(definitionSchema, { definition }), { definition });
  });

  it('bounds names, descriptions and definition size', () => {
    const base = { key: 'billing.x', kind: 'node' };
    assert.equal(v.safeParse(createGraphSchema, { ...base, name: 'x'.repeat(121) }).success, false);
    assert.equal(
      v.safeParse(createGraphSchema, { ...base, name: 'X', description: 'x'.repeat(2001) }).success,
      false
    );
    const definition = templateFor('node');
    assert.equal(v.safeParse(definitionSchema, { definition }).success, true);
    const huge = {
      ...definition,
      variables: [{ name: 'x', type: 'string', default: 'x'.repeat(2_000_000) }]
    };
    assert.equal(v.safeParse(definitionSchema, { definition: huge }).success, false);
  });

  it('parses version params', () => {
    const id = '01a16617-7704-7ba6-b9b5-9c79fa44f965';
    assert.equal(v.parse(versionParam, { id, version: '3' }).version, 3);
    assert.equal(v.safeParse(versionParam, { id, version: '0' }).success, false);
    assert.equal(v.safeParse(versionParam, { id, version: '99999999999' }).success, false);
  });
});

describe('graph rebase schema', () => {
  it('rebases by keeping or resetting', () => {
    assert.deepEqual(v.parse(rebaseSchema, { mode: 'keep' }), { mode: 'keep' });
    assert.deepEqual(v.parse(rebaseSchema, { mode: 'reset' }), { mode: 'reset' });
    assert.equal(v.safeParse(rebaseSchema, {}).success, false);
    assert.equal(v.safeParse(rebaseSchema, { mode: 'merge' }).success, false);
  });
});

describe('graph search query', () => {
  it('shows workflows by name by default and rejects unknown views and sorts', () => {
    assert.deepEqual(v.parse(searchGraphsQuery, {}), {
      show: 'workflows',
      page: 1,
      pageSize: 25,
      sort: 'name',
      dir: 'asc'
    });
    assert.equal(v.safeParse(searchGraphsQuery, { show: 'system' }).success, false);
    assert.equal(v.safeParse(searchGraphsQuery, { sort: 'status' }).success, false);
    assert.equal(v.safeParse(searchGraphsQuery, { page: '0' }).success, false);
  });
});
