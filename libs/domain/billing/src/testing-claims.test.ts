import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { memoryClaims } from './testing-claims.ts';

describe('memoryClaims', () => {
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
});
