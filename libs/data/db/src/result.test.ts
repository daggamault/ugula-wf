import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fail, ok } from './result.ts';

describe('ok', () => {
  it('wraps a value, even a falsy one', () => {
    assert.deepEqual(ok(0), { ok: true, value: 0 });
    assert.deepEqual(ok(null), { ok: true, value: null });
  });
});

describe('fail', () => {
  it('wraps a failure code and message', () => {
    assert.deepEqual(fail('not_found', 'No claim'), {
      ok: false,
      failure: { code: 'not_found', message: 'No claim' }
    });
  });

  it('carries details when given', () => {
    assert.deepEqual(fail('conflict', 'Taken', { id: 'c1' }), {
      ok: false,
      failure: { code: 'conflict', message: 'Taken', details: { id: 'c1' } }
    });
  });

  it('leaves the details key out when there are none', () => {
    assert.equal('details' in fail('invalid', 'Bad').failure, false);
    assert.equal('details' in fail('invalid', 'Bad', undefined).failure, false);
  });
});
