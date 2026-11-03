import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fail, ok } from './result.ts';

describe('result', () => {
  it('wraps values and failures', () => {
    assert.deepEqual(ok(0), { ok: true, value: 0 });
    assert.deepEqual(fail('not_found', 'No claim'), {
      ok: false,
      failure: { code: 'not_found', message: 'No claim' }
    });
    assert.deepEqual(fail('conflict', 'Taken', { id: 'c1' }), {
      ok: false,
      failure: { code: 'conflict', message: 'Taken', details: { id: 'c1' } }
    });
    assert.equal('details' in fail('invalid', 'Bad').failure, false);
  });
});
