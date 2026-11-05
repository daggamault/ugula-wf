import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { billingStores, scriptedCompleter } from './testing-stores.ts';

describe('billingStores', () => {
  it('answers completions from a script and fills unused stores with faults', async () => {
    const { completer, asked } = scriptedCompleter(() => ({ ok: true }));
    const stores = billingStores({ completer });
    assert.deepEqual(
      await stores.completer.complete({ system: 's', user: 'u', schema: {}, maxTokens: 1 }),
      { ok: true }
    );
    assert.equal(asked.length, 1);
    await assert.rejects(() => stores.fees.findSchedules('r', null, []), /fee store is not used/);
  });
});
