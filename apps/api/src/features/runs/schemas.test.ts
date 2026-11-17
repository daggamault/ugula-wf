import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { fileFormSchema, listStepsQuery, searchRunsQuery, startRunSchema } from './schemas.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const issues = (schema: v.GenericSchema, input: unknown) =>
  v.safeParse(schema, input).issues?.map((i) => i.message);

describe('startRunSchema', () => {
  it('starts the newest version with no inputs by default', () => {
    assert.deepEqual(v.parse(startRunSchema, { graphId: ID }), { graphId: ID, inputs: {} });
  });

  it('takes a version and JSON inputs', () => {
    assert.deepEqual(
      v.parse(startRunSchema, { graphId: ID, version: 2_147_483_647, inputs: { a: [1, null] } }),
      { graphId: ID, version: 2_147_483_647, inputs: { a: [1, null] } }
    );
  });

  it('rejects a workflow id that is not a UUID', () => {
    assert.deepEqual(issues(startRunSchema, { graphId: 'x' }), ['Invalid UUID: Received "x"']);
  });

  it('rejects versions outside 1..2^31-1 and inputs that are not an object', () => {
    assert.deepEqual(issues(startRunSchema, { graphId: ID, version: 0 }), [
      'Invalid value: Expected >=1 but received 0'
    ]);
    assert.deepEqual(issues(startRunSchema, { graphId: ID, version: 2 ** 31 }), [
      'Invalid value: Expected <=2147483647 but received 2147483648'
    ]);
    assert.equal(v.safeParse(startRunSchema, { graphId: ID, inputs: 'x' }).success, false);
  });
});

describe('searchRunsQuery', () => {
  it('lists top-level runs newest first by default', () => {
    assert.deepEqual(v.parse(searchRunsQuery, {}), {
      root: 'true',
      page: 1,
      pageSize: 25,
      sort: 'started',
      dir: 'desc'
    });
  });

  it('narrows by status, workflow and nesting with trimmed search text', () => {
    assert.deepEqual(
      v.parse(searchRunsQuery, {
        q: ' ingest ',
        status: 'faulted',
        graphId: ID,
        root: 'false',
        sort: 'finished'
      }),
      {
        q: 'ingest',
        status: 'faulted',
        graphId: ID,
        root: 'false',
        page: 1,
        pageSize: 25,
        sort: 'finished',
        dir: 'desc'
      }
    );
  });

  it('rejects unknown statuses, bad workflow ids, nesting flags, sorts and long searches', () => {
    for (const bad of [
      { status: 'odd' },
      { graphId: 'g1' },
      { root: 'yes' },
      { q: 'x'.repeat(81) },
      { sort: 'name' }
    ]) {
      assert.equal(v.safeParse(searchRunsQuery, bad).success, false, JSON.stringify(bad));
    }
  });
});

describe('listStepsQuery', () => {
  it('reads 500 steps from the start by default', () => {
    assert.deepEqual(v.parse(listStepsQuery, {}), { after: 0, limit: 500 });
  });

  it('takes a path, node, cursor and limit', () => {
    assert.deepEqual(
      v.parse(listStepsQuery, { path: 'sub/', node: 'n1', after: '5', limit: '2000' }),
      { path: 'sub/', node: 'n1', after: 5, limit: 2000 }
    );
  });

  it('rejects cursors beyond safe integers or below zero and limits outside 1..2000', () => {
    assert.deepEqual(issues(listStepsQuery, { after: '1e300' }), [
      'Invalid value: Expected <=9007199254740991 but received 1e+300'
    ]);
    assert.deepEqual(issues(listStepsQuery, { after: '-1' }), [
      'Invalid value: Expected >=0 but received -1'
    ]);
    assert.deepEqual(issues(listStepsQuery, { limit: '0' }), [
      'Invalid value: Expected >=1 but received 0'
    ]);
    assert.deepEqual(issues(listStepsQuery, { limit: '2001' }), [
      'Invalid value: Expected <=2000 but received 2001'
    ]);
  });

  it('rejects paths and nodes over 200 characters', () => {
    for (const key of ['path', 'node']) {
      assert.deepEqual(
        issues(listStepsQuery, { [key]: 'x'.repeat(201) }),
        ['Invalid length: Expected <=200 but received 201'],
        key
      );
    }
  });
});

describe('fileFormSchema', () => {
  it('needs an uploaded file', () => {
    const file = new File(['x'], 'a.xml');
    assert.equal(v.parse(fileFormSchema, { file }).file, file);
    assert.equal(v.safeParse(fileFormSchema, { file: 'a.xml' }).success, false);
  });
});
