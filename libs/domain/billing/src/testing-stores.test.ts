import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { billingStores, scriptedCompleter } from './testing-stores.ts';

const request = { system: 's', user: 'u', schema: {}, maxTokens: 1 };

describe('scriptedCompleter', () => {
  it('answers from the script and records each request', async () => {
    const { completer, asked } = scriptedCompleter((r) => ({ echo: r.user }));
    assert.deepEqual(await completer.complete(request), { echo: 'u' });
    assert.deepEqual(asked, [request]);
  });
});

describe('billingStores', () => {
  it('uses the stores it is given', async () => {
    const { completer } = scriptedCompleter(() => ({ ok: true }));
    assert.deepEqual(await billingStores({ completer }).completer.complete(request), { ok: true });
  });

  it('fills stores it is not given with ones that fail, naming the store', async () => {
    const stores = billingStores();
    await assert.rejects(() => stores.fees.findSchedules('r', null, []), {
      message: 'The fee store is not used here'
    });
    await assert.rejects(() => stores.completer.complete(request), {
      message: 'The completion store is not used here'
    });
  });

  it('gives an empty payer directory and no cached suggestions by default', async () => {
    const { payers } = billingStores();
    assert.deepEqual(await payers.directory('r'), []);
    assert.equal(await payers.cachedSuggestion('r', 'Medicare'), undefined);
  });

  it('dates today in Chicago by default', async () => {
    const { calendar } = billingStores();
    assert.equal(await calendar.today('r', new Date('2026-11-06T03:00:00Z')), '2026-11-05');
  });
});
