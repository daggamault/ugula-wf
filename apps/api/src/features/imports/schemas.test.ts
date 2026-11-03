import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { importFormSchema, listImportsQuery, listReportsQuery } from './schemas.ts';

describe('importFormSchema', () => {
  it('requires a file and defaults the workflow', () => {
    const file = new File(['<x/>'], 'a.xml');
    assert.equal(v.parse(importFormSchema, { file }).workflow, 'billing.ingest-nemsis');
    assert.equal(v.safeParse(importFormSchema, { file: 'nope' }).success, false);
    assert.equal(v.safeParse(importFormSchema, { file, workflow: 'Bad Key' }).success, false);
  });
});

describe('import list queries', () => {
  it('default the sort and bound the search text', () => {
    assert.deepEqual(v.parse(listImportsQuery, { q: ' acme ' }), {
      q: 'acme',
      page: 1,
      pageSize: 25,
      sort: 'received',
      dir: 'desc'
    });
    assert.equal(v.safeParse(listImportsQuery, { q: 'x'.repeat(81) }).success, false);
    assert.deepEqual(v.parse(listReportsQuery, {}), {
      page: 1,
      pageSize: 25,
      sort: 'position',
      dir: 'asc'
    });
    assert.equal(v.safeParse(listReportsQuery, { sort: 'file' }).success, false);
  });
});
