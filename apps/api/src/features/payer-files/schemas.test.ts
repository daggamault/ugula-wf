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
  });
});
