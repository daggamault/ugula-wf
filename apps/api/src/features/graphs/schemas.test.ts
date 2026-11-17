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

const issues = (schema: v.GenericSchema, input: unknown) =>
  v.safeParse(schema, input).issues?.map((i) => i.message);

const KEY_RULE = 'Use dotted lowercase keys like billing.match-patient';

describe('create graph schema', () => {
  it('leaves the key out when none is given, so one is generated', () => {
    assert.deepEqual(v.parse(createGraphSchema, { name: 'Match', kind: 'node' }), {
      name: 'Match',
      kind: 'node',
      description: ''
    });
  });

  it('trims and lowercases the key and defaults the description', () => {
    assert.deepEqual(
      v.parse(createGraphSchema, { key: ' Billing.Match-Patient ', name: ' Match ', kind: 'node' }),
      { key: 'billing.match-patient', name: 'Match', kind: 'node', description: '' }
    );
  });

  it('keeps a role and drops a scope', () => {
    assert.deepEqual(
      v.parse(createGraphSchema, {
        key: 'a.b',
        name: 'X',
        kind: 'node',
        role: 'stage',
        scope: 'organization'
      }),
      { key: 'a.b', name: 'X', kind: 'node', role: 'stage', description: '' }
    );
  });

  it('refuses keys that are not dotted lowercase words', () => {
    for (const key of ['nodot', '1bad.key', 'a..b', 'a.b_c']) {
      assert.deepEqual(
        issues(createGraphSchema, { key, name: 'X', kind: 'node' }),
        [KEY_RULE],
        key
      );
    }
  });

  it('reserves the std namespace', () => {
    assert.deepEqual(issues(createGraphSchema, { key: 'std.thing', name: 'X', kind: 'node' }), [
      'The std namespace is reserved'
    ]);
  });

  it('bounds the key, name and description', () => {
    const base = { key: 'billing.x', name: 'X', kind: 'node' };
    assert.deepEqual(issues(createGraphSchema, { ...base, key: `${'x'.repeat(119)}.b` }), [
      'Invalid length: Expected <=120 but received 121'
    ]);
    assert.deepEqual(issues(createGraphSchema, { ...base, name: '  ' }), [
      'Invalid length: Expected !0 but received 0'
    ]);
    assert.deepEqual(issues(createGraphSchema, { ...base, name: 'x'.repeat(121) }), [
      'Invalid length: Expected <=120 but received 121'
    ]);
    assert.deepEqual(issues(createGraphSchema, { ...base, description: 'x'.repeat(2001) }), [
      'Invalid length: Expected <=2000 but received 2001'
    ]);
  });

  it('refuses unknown kinds and roles', () => {
    const base = { key: 'billing.x', name: 'X' };
    assert.deepEqual(issues(createGraphSchema, { ...base, kind: 'table' }), [
      'Invalid type: Expected ("workflow" | "node") but received "table"'
    ]);
    assert.deepEqual(issues(createGraphSchema, { ...base, kind: 'node', role: 'workflow' }), [
      'Invalid type: Expected ("stage" | "rule" | "slot") but received "workflow"'
    ]);
  });
});

describe('graph definition schema', () => {
  it('keeps comment boxes in a saved definition', () => {
    const definition = {
      ...templateFor('workflow'),
      comments: [{ id: 'c1', text: 'Why', position: { x: 1, y: 2 }, size: { width: 3, height: 4 } }]
    };
    assert.deepEqual(v.parse(definitionSchema, { definition }), { definition });
  });

  it('refuses a definition that is too large to save', () => {
    const huge = {
      ...templateFor('node'),
      variables: [{ name: 'x', type: 'string', default: 'x'.repeat(2_000_000) }]
    };
    assert.deepEqual(issues(definitionSchema, { definition: huge }), [
      'The graph is too large to save'
    ]);
  });

  it('refuses a definition without its parts', () => {
    assert.deepEqual(issues(definitionSchema, { definition: {} }), [
      'Invalid key: Expected "signature" but received undefined',
      'Invalid key: Expected "variables" but received undefined',
      'Invalid key: Expected "nodes" but received undefined',
      'Invalid key: Expected "edges" but received undefined'
    ]);
  });
});

describe('graph version param', () => {
  const id = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

  it('reads versions as positive 32-bit integers', () => {
    assert.deepEqual(v.parse(versionParam, { id, version: '3' }), { id, version: 3 });
    assert.deepEqual(v.parse(versionParam, { id, version: '2147483647' }), {
      id,
      version: 2_147_483_647
    });
  });

  it('refuses zero, fractions, words and versions past 32 bits', () => {
    assert.deepEqual(issues(versionParam, { id, version: '0' }), [
      'Invalid value: Expected >=1 but received 0'
    ]);
    assert.deepEqual(issues(versionParam, { id, version: '1.5' }), [
      'Invalid integer: Received 1.5'
    ]);
    assert.equal(v.safeParse(versionParam, { id, version: 'x' }).success, false);
    assert.deepEqual(issues(versionParam, { id, version: '2147483648' }), [
      'Invalid value: Expected <=2147483647 but received 2147483648'
    ]);
  });

  it('refuses an id that is not a uuid', () => {
    assert.deepEqual(issues(versionParam, { id: 'nope', version: '1' }), [
      'Invalid UUID: Received "nope"'
    ]);
  });
});

describe('graph rebase schema', () => {
  it('rebases by keeping or resetting', () => {
    assert.deepEqual(v.parse(rebaseSchema, { mode: 'keep' }), { mode: 'keep' });
    assert.deepEqual(v.parse(rebaseSchema, { mode: 'reset' }), { mode: 'reset' });
  });

  it('requires a known mode', () => {
    assert.deepEqual(issues(rebaseSchema, {}), [
      'Invalid key: Expected "mode" but received undefined'
    ]);
    assert.deepEqual(issues(rebaseSchema, { mode: 'merge' }), [
      'Invalid type: Expected ("keep" | "reset") but received "merge"'
    ]);
  });
});

describe('graph search query', () => {
  it('shows workflows by name by default', () => {
    assert.deepEqual(v.parse(searchGraphsQuery, {}), {
      show: 'workflows',
      page: 1,
      pageSize: 25,
      sort: 'name',
      dir: 'asc'
    });
  });

  it('reads a trimmed search, view, page and sort', () => {
    assert.deepEqual(
      v.parse(searchGraphsQuery, {
        q: '  Match ',
        show: 'customized',
        page: '2',
        pageSize: '50',
        sort: 'updated',
        dir: 'desc'
      }),
      { q: 'Match', show: 'customized', page: 2, pageSize: 50, sort: 'updated', dir: 'desc' }
    );
  });

  it('refuses unknown views and sorts, page zero and long searches', () => {
    assert.deepEqual(issues(searchGraphsQuery, { show: 'system' }), [
      'Invalid type: Expected ("workflows" | "blocks" | "mine" | "customized" | "all") but received "system"'
    ]);
    assert.deepEqual(issues(searchGraphsQuery, { sort: 'status' }), [
      'Invalid type: Expected ("name" | "kind" | "updated") but received "status"'
    ]);
    assert.deepEqual(issues(searchGraphsQuery, { page: '0' }), [
      'Invalid value: Expected >=1 but received 0'
    ]);
    assert.deepEqual(issues(searchGraphsQuery, { q: 'x'.repeat(81) }), [
      'Invalid length: Expected <=80 but received 81'
    ]);
  });
});
