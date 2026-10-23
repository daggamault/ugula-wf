import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { createGraphSchema, versionParam } from './schemas.ts';

describe('graph schemas', () => {
  it('normalizes keys and reserves the std namespace', () => {
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
  });

  it('parses version params', () => {
    assert.equal(
      v.parse(versionParam, { id: '01a16617-7704-7ba6-b9b5-9c79fa44f965', version: '3' }).version,
      3
    );
    assert.equal(
      v.safeParse(versionParam, { id: '01a16617-7704-7ba6-b9b5-9c79fa44f965', version: '0' })
        .success,
      false
    );
  });
});
