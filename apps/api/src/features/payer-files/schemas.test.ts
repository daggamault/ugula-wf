import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { listPayerFilesQuery, payerFileFormSchema } from './schemas.ts';

describe('payer file schemas', () => {
  it('pages newest files first and takes one uploaded file', () => {
    assert.deepEqual(v.parse(listPayerFilesQuery, {}), {
      page: 1,
      pageSize: 25,
      sort: 'received',
      dir: 'desc'
    });
    assert.ok(v.safeParse(payerFileFormSchema, { file: new File(['x'], 'a.835') }).success);
    assert.ok(!v.safeParse(payerFileFormSchema, { file: 'a.835' }).success);
    assert.ok(!v.safeParse(payerFileFormSchema, {}).success);
  });

  it('rejects unknown sorts, directions and page sizes', () => {
    assert.deepEqual(v.parse(listPayerFilesQuery, { sort: 'name', dir: 'asc', page: '3' }), {
      page: 3,
      pageSize: 25,
      sort: 'name',
      dir: 'asc'
    });
    for (const bad of [{ sort: 'uploaded_by' }, { dir: 'up' }, { pageSize: '7' }, { page: '0' }]) {
      assert.equal(v.safeParse(listPayerFilesQuery, bad).success, false, JSON.stringify(bad));
    }
  });
});
