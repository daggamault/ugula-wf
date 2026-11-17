import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import {
  importFormSchema,
  listImportReportsQuery,
  searchImportsQuery,
  sftpAuthSchema,
  sftpEventSchema
} from './schemas.ts';

const issues = (schema: v.GenericSchema, input: unknown) =>
  v.safeParse(schema, input).issues?.map((i) => i.message);

describe('importFormSchema', () => {
  const file = new File(['<x/>'], 'a.xml');

  it('takes a file', () => {
    assert.deepEqual(v.parse(importFormSchema, { file }), { file });
  });

  it('refuses a missing file', () => {
    assert.deepEqual(issues(importFormSchema, { file: 'nope' }), [
      'Invalid type: Expected File but received "nope"'
    ]);
  });
});

describe('searchImportsQuery', () => {
  it('trims the search and shows the newest imports first by default', () => {
    assert.deepEqual(v.parse(searchImportsQuery, { q: ' acme ' }), {
      q: 'acme',
      page: 1,
      pageSize: 25,
      sort: 'received',
      dir: 'desc'
    });
  });

  it('refuses long searches and unlisted page sizes', () => {
    assert.deepEqual(issues(searchImportsQuery, { q: 'x'.repeat(81) }), [
      'Invalid length: Expected <=80 but received 81'
    ]);
    assert.deepEqual(issues(searchImportsQuery, { pageSize: '30' }), [
      'Invalid type: Expected (10 | 25 | 50 | 100) but received 30'
    ]);
  });
});

describe('listImportReportsQuery', () => {
  it('pages reports in file order by default', () => {
    assert.deepEqual(v.parse(listImportReportsQuery, {}), {
      page: 1,
      pageSize: 25,
      sort: 'position',
      dir: 'asc'
    });
  });

  it('refuses sorts of the import list', () => {
    assert.deepEqual(issues(listImportReportsQuery, { sort: 'file' }), [
      'Invalid type: Expected ("position" | "pcr" | "patient" | "outcome" | "claim" | "total") but received "file"'
    ]);
  });
});

describe('sftpAuthSchema', () => {
  it('keeps extra hook fields and defaults the password', () => {
    assert.deepEqual(v.parse(sftpAuthSchema, { username: 'acme', ip: '1.2.3.4' }), {
      username: 'acme',
      password: '',
      ip: '1.2.3.4'
    });
  });

  it('requires a username', () => {
    assert.deepEqual(issues(sftpAuthSchema, { username: '' }), [
      'Invalid length: Expected !0 but received 0'
    ]);
    assert.deepEqual(issues(sftpAuthSchema, {}), [
      'Invalid key: Expected "username" but received undefined'
    ]);
  });
});

describe('sftpEventSchema', () => {
  const event = { action: 'upload', username: 'acme', virtual_path: '/a.xml', status: 1 };

  it('keeps extra hook fields and defaults the file size', () => {
    assert.deepEqual(v.parse(sftpEventSchema, { ...event, protocol: 'SFTP' }), {
      ...event,
      file_size: 0,
      protocol: 'SFTP'
    });
  });

  it('refuses events without a user, path, whole size or numeric status', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ username: '' }, 'Invalid length: Expected !0 but received 0'],
      [{ virtual_path: '' }, 'Invalid length: Expected !0 but received 0'],
      [
        { virtual_path: `/${'x'.repeat(1024)}` },
        'Invalid length: Expected <=1024 but received 1025'
      ],
      [{ file_size: -1 }, 'Invalid value: Expected >=0 but received -1'],
      [{ file_size: 1.5 }, 'Invalid integer: Received 1.5'],
      [{ status: '1' }, 'Invalid type: Expected number but received "1"'],
      [{ action: undefined }, 'Invalid type: Expected string but received undefined']
    ];
    for (const [patch, message] of cases) {
      assert.deepEqual(issues(sftpEventSchema, { ...event, ...patch }), [message], message);
    }
  });
});
