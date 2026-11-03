import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import {
  importFormSchema,
  listImportsQuery,
  listReportsQuery,
  sftpAuthSchema,
  sftpEventSchema
} from './schemas.ts';

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

describe('SFTP hook schemas', () => {
  it('keep extra hook fields, default passwords and sizes and bound paths', () => {
    assert.deepEqual(v.parse(sftpAuthSchema, { username: 'acme', ip: '1.2.3.4' }), {
      username: 'acme',
      password: '',
      ip: '1.2.3.4'
    });
    assert.equal(v.safeParse(sftpAuthSchema, { username: '' }).success, false);
    const event = { action: 'upload', username: 'acme', virtual_path: '/a.xml', status: 1 };
    assert.equal(v.parse(sftpEventSchema, event).file_size, 0);
    for (const patch of [
      { username: '' },
      { virtual_path: '' },
      { virtual_path: `/${'x'.repeat(1024)}` },
      { file_size: -1 },
      { file_size: 1.5 },
      { status: '1' }
    ]) {
      assert.equal(v.safeParse(sftpEventSchema, { ...event, ...patch }).success, false);
    }
  });
});
