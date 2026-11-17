import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { memoryFees, memoryPatients, memoryPayers } from './testing-party-stores.ts';

const medicare = { id: 'p-medicare', name: 'Medicare', claimFiling: 'MB' };
const blue = { id: 'p-blue', name: 'Blue', claimFiling: 'BL', similarity: 0.7 };
const jane = {
  firstName: 'Jane',
  lastName: 'Doe',
  birthDate: '1980-01-02',
  gender: null,
  addressLine: null,
  city: null,
  state: null,
  postalCode: null
};
const address = { addressLine: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701' };

describe('memoryPatients', () => {
  it('creates patients from what they are given and records the call', async () => {
    const { store, calls } = memoryPatients([]);
    assert.deepEqual(await store.createPatient('r', 'k', jane, true), { id: 'new', ...jane });
    assert.deepEqual(calls, [['createPatient', 'r', 'k', true]]);
  });

  it('finds existing patients by id and nothing for unknown ids', async () => {
    const { store, calls } = memoryPatients([{ id: 'p1', ...jane }]);
    assert.deepEqual(await store.findPatient('r', 'p1'), { id: 'p1', ...jane });
    assert.equal(await store.findPatient('r', 'x'), null);
    assert.deepEqual(calls, [
      ['findPatient', 'r', 'p1'],
      ['findPatient', 'r', 'x']
    ]);
  });

  it('updates the address of an existing patient', async () => {
    const { store } = memoryPatients([{ id: 'p1', ...jane }]);
    assert.deepEqual(await store.updateAddress('r', 'k', 'p1', address), {
      id: 'p1',
      ...jane,
      ...address
    });
  });

  it('refuses to update the address of an unknown patient', async () => {
    const { store } = memoryPatients([]);
    await assert.rejects(() => store.updateAddress('r', 'k', 'p9', address), {
      message: 'Patient p9 does not exist'
    });
  });
});

describe('memoryPayers', () => {
  it('links known payers and offers similar ones only when asked', async () => {
    const { store } = memoryPayers({ Medicare: medicare }, { BCBS: [blue] });
    assert.deepEqual(await store.lookup('r', ['Medicare', 'BCBS'], true), [
      { name: 'Medicare', known: medicare, candidates: [] },
      { name: 'BCBS', known: null, candidates: [blue] }
    ]);
    assert.deepEqual(await store.lookup('r', ['BCBS', 'Aetna'], false), [
      { name: 'BCBS', known: null, candidates: [] },
      { name: 'Aetna', known: null, candidates: [] }
    ]);
  });

  it('learns aliases to payers it knows and links them on later lookups', async () => {
    const { store, aliases } = memoryPayers({ Medicare: medicare }, { BCBS: [blue] });
    assert.equal(await store.linkAlias('r', 'BCBS', 'p-blue'), true);
    assert.equal(await store.linkAlias('r', 'BCBS', 'p-none'), false);
    assert.deepEqual([...aliases], [['BCBS', 'p-blue']]);
    assert.deepEqual(await store.lookup('r', ['BCBS'], false), [
      { name: 'BCBS', known: { id: 'p-blue', name: 'Blue', claimFiling: 'BL' }, candidates: [] }
    ]);
  });

  it('lists known and similar payers in its directory', async () => {
    const { store } = memoryPayers({ Medicare: medicare }, { BCBS: [blue] });
    assert.deepEqual(await store.directory('r'), [
      medicare,
      { id: 'p-blue', name: 'Blue', claimFiling: 'BL' }
    ]);
  });

  it('fails similar lookups when search is down but still answers plain ones', async () => {
    const { store } = memoryPayers({ Medicare: medicare }, {}, { searchDown: true });
    await assert.rejects(() => store.lookup('r', ['Medicare'], true), {
      message: 'The embedding server is down'
    });
    assert.deepEqual(await store.lookup('r', ['Medicare'], false), [
      { name: 'Medicare', known: medicare, candidates: [] }
    ]);
  });

  it('caches suggestions, including no suggestion', async () => {
    const { store } = memoryPayers({});
    assert.equal(await store.cachedSuggestion('r', 'BCBS'), undefined);
    await store.cacheSuggestion('r', 'BCBS', 'p-blue');
    await store.cacheSuggestion('r', 'Aetna', null);
    assert.equal(await store.cachedSuggestion('r', 'BCBS'), 'p-blue');
    assert.equal(await store.cachedSuggestion('r', 'Aetna'), null);
  });
});

describe('memoryFees', () => {
  it('prices only the codes the schedule knows', async () => {
    const { store } = memoryFees((_, code) => (code === 'A0427' ? 100 : null));
    assert.deepEqual(await store.findSchedules('r', null, ['A0427', 'A0999']), {
      payer: {},
      default: { A0427: 100 }
    });
  });

  it('prefers the latest saved fee for the payer or default schedule', async () => {
    const { store, saved } = memoryFees((_, code) => (code === 'A0427' ? 100 : null));
    await store.saveFee('r', null, 'A0999', 5);
    await store.saveFee('r', 'p1', 'A0427', 80);
    await store.saveFee('r', 'p1', 'A0427', 90);
    assert.deepEqual(await store.findSchedules('r', 'p1', ['A0427', 'A0999']), {
      payer: { A0427: 90 },
      default: { A0427: 100, A0999: 5 }
    });
    assert.deepEqual(saved, [
      [null, 'A0999', 5],
      ['p1', 'A0427', 80],
      ['p1', 'A0427', 90]
    ]);
  });
});
