import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { importFormSchema } from './schemas.ts';

describe('importFormSchema', () => {
  it('requires a file and defaults the workflow', () => {
    const file = new File(['<x/>'], 'a.xml');
    assert.equal(v.parse(importFormSchema, { file }).workflow, 'billing.ingest-nemsis');
    assert.equal(v.safeParse(importFormSchema, { file: 'nope' }).success, false);
    assert.equal(v.safeParse(importFormSchema, { file, workflow: 'Bad Key' }).success, false);
  });
});
