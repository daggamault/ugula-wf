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
    const [known, similar] = await store.lookup('r', ['Medicare', 'BCBS'], true);
    assert.equal(known?.known?.id, 'p-medicare');
    assert.deepEqual(similar?.candidates, [blue]);
    assert.equal(await store.linkAlias('r', 'BCBS', 'p-blue'), true);
    assert.equal(await store.linkAlias('r', 'BCBS', 'p-none'), false);
    assert.deepEqual([...aliases], [['BCBS', 'p-blue']]);
    assert.equal((await store.lookup('r', ['BCBS'], false))[0]?.known?.id, 'p-blue');
    assert.deepEqual(
      (await store.directory('r')).map((p) => p.id),
      ['p-medicare', 'p-blue']
    );
  });

  it('prices only the codes the schedule knows', async () => {
    const { store } = memoryFees((_, code) => (code === 'A0427' ? 100 : null));
    assert.deepEqual(await store.findSchedules('r', null, ['A0427', 'A0999']), {
      payer: {},
      default: { A0427: 100 }
    });
    await store.saveFee('r', null, 'A0999', 5);
    await store.saveFee('r', 'p1', 'A0427', 90);
    assert.deepEqual(await store.findSchedules('r', 'p1', ['A0427', 'A0999']), {
      payer: { A0427: 90 },
      default: { A0427: 100, A0999: 5 }
    });
  });

  it('keeps a claim ledger from saved coverages and recorded events', async () => {
    const claims = memoryClaims({ totalCents: 500 });
    assert.deepEqual(
      await claims.store.openDraft('r', 'k', { pcrNumber: null, reportKey: null, claimId: null }),
      { id: 'c1', duplicate: false }
    );
    await claims.store.assignPatient('r', 'c1', 'k', 'p1');

    assert.deepEqual(claims.patients, ['p1']);
    await claims.store.recordEvent('r', 'c1', 'k', {
      kind: 'approved',
      coverageId: null,
      note: '',
      payerClaimNumber: null
    });
    const ledger = await claims.store.ledger('r', 'c1');
    assert.equal(ledger?.totalCents, 500);
    assert.equal(ledger?.events[0]?.kind, 'approved');
    assert.equal(await claims.store.ledger('r', 'c9'), null);
    await assert.rejects(() => claims.store.statementData('r', 'c1'), /not used here/);
    await claims.store.saveStatement('r', 'c1', 'k', {
      number: 1,
      count: 3,
      pdf: new Uint8Array()
    });
    assert.deepEqual(claims.statements, [{ key: 'k', number: 1, count: 3, pdf: new Uint8Array() }]);
  });

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
