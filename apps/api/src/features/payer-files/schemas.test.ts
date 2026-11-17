import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { payerFileFormSchema, searchPayerFilesQuery } from './schemas.ts';

const issues = (schema: v.GenericSchema, input: unknown) =>
  v.safeParse(schema, input).issues?.map((i) => i.message);

describe('searchPayerFilesQuery', () => {
  it('pages newest files first by default', () => {
    assert.deepEqual(v.parse(searchPayerFilesQuery, {}), {
      page: 1,
      pageSize: 25,
      sort: 'received',
      dir: 'desc'
    });
  });

  it('reads a page, sort and direction', () => {
    assert.deepEqual(v.parse(searchPayerFilesQuery, { sort: 'name', dir: 'asc', page: '3' }), {
      page: 3,
      pageSize: 25,
      sort: 'name',
      dir: 'asc'
    });
  });

  it('refuses unknown sorts, directions and page sizes and page zero', () => {
    const cases: [Record<string, unknown>, string][] = [
      [
        { sort: 'uploaded_by' },
        'Invalid type: Expected ("received" | "name" | "kind" | "problems") but received "uploaded_by"'
      ],
      [{ dir: 'up' }, 'Invalid type: Expected ("asc" | "desc") but received "up"'],
      [{ pageSize: '7' }, 'Invalid type: Expected (10 | 25 | 50 | 100) but received 7'],
      [{ page: '0' }, 'Invalid value: Expected >=1 but received 0']
    ];
    for (const [input, message] of cases) {
      assert.deepEqual(issues(searchPayerFilesQuery, input), [message], message);
    }
  });
});

describe('payerFileFormSchema', () => {
  it('takes one uploaded file', () => {
    const file = new File(['x'], 'a.835');
    assert.deepEqual(v.parse(payerFileFormSchema, { file }), { file });
  });

  it('refuses a missing file or a file name in its place', () => {
    assert.deepEqual(issues(payerFileFormSchema, { file: 'a.835' }), [
      'Invalid type: Expected File but received "a.835"'
    ]);
    assert.deepEqual(issues(payerFileFormSchema, {}), [
      'Invalid key: Expected "file" but received undefined'
    ]);
  });
});
