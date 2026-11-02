import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  billingStores,
  memoryClaims,
  memoryFees,
  memoryPatients,
  memoryPayers,
  scriptedCompleter
} from './testing.ts';

const medicare = { id: 'p-medicare', name: 'Medicare', claimFiling: 'MB' };

describe('billing test stores', () => {
  it('records patient calls and creates patients from what they are given', async () => {
    const { store, calls } = memoryPatients([]);
    const created = await store.createPatient(
      'r',
      'k',
      {
        firstName: 'Jane',
        lastName: 'Doe',
        birthDate: '1980-01-02',
        gender: null,
        addressLine: null,
        city: null,
        state: null,
        postalCode: null
      },
      true
    );
    assert.equal(created.id, 'new');
    assert.deepEqual(calls, [['createPatient', 'r', 'k', true]]);
    assert.equal(await store.findPatient('r', 'x'), null);
  });

  it('links known payers, offers similar ones and learns aliases', async () => {
    const blue = { id: 'p-blue', name: 'Blue', claimFiling: 'BL', similarity: 0.7 };
    const { store, aliases } = memoryPayers({ Medicare: medicare }, { BCBS: [blue] });
    const [known, similar] = await store.lookup('r', ['Medicare', 'BCBS']);
    assert.equal(known?.known?.id, 'p-medicare');
    assert.deepEqual(similar?.candidates, [blue]);
    await store.linkAlias('r', 'BCBS', 'p-blue');
    assert.deepEqual([...aliases], [['BCBS', 'p-blue']]);
    assert.equal((await store.lookup('r', ['BCBS']))[0]?.known?.id, 'p-blue');
  });

  it('prices only the codes the schedule knows', async () => {
    const { store } = memoryFees((_, code) => (code === 'A0427' ? 100 : null));
    assert.deepEqual(await store.findFees('r', null, ['A0427', 'A0999']), { A0427: 100 });
  });

  it('keeps a claim ledger from saved coverages and recorded events', async () => {
    const claims = memoryClaims({ pcrNumbers: { 'PCR-1': 'c1' }, totalCents: 500 });
    assert.equal(await claims.store.findByPcr('r', 'PCR-1'), 'c1');
    assert.deepEqual(
      await claims.store.openDraft('r', 'k', {
        patientId: 'p1',
        pcrNumber: null,
        reportKey: null
      }),
      { id: 'c1', duplicate: false }
    );
    await claims.store.recordEvent('r', 'c1', 'k', {
      kind: 'approved',
      coverageId: null,
      note: ''
    });
    const ledger = await claims.store.ledger('r', 'c1');
    assert.equal(ledger?.totalCents, 500);
    assert.equal(ledger?.events[0]?.kind, 'approved');
    assert.equal(await claims.store.ledger('r', 'c9'), null);
    await assert.rejects(() => claims.store.statementData('r', 'c1'), /not used here/);
  });

  it('answers completions from a script and fills unused stores with faults', async () => {
    const { completer, asked } = scriptedCompleter(() => ({ ok: true }));
    const stores = billingStores({ completer });
    assert.deepEqual(
      await stores.completer.complete({ system: 's', user: 'u', schema: {}, maxTokens: 1 }),
      { ok: true }
    );
    assert.equal(asked.length, 1);
    await assert.rejects(() => stores.fees.findFees('r', null, []), /fee store is not used/);
  });
});
