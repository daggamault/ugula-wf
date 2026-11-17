import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { memoryClaims } from './testing-claims.ts';

const draft = { pcrNumber: null, reportKey: null, claimId: null };
const approved = {
  kind: 'approved',
  coverageId: null,
  note: '',
  payerClaimNumber: null
} as const;

describe('memoryClaims', () => {
  it('opens the configured claim and marks every later new draft a duplicate', async () => {
    const claims = memoryClaims({ claimId: 'c7' });
    assert.deepEqual(await claims.store.openDraft('r', 'k', draft), {
      id: 'c7',
      duplicate: false
    });
    assert.deepEqual(await claims.store.openDraft('r', 'k', draft), {
      id: 'c7',
      duplicate: true
    });
    assert.deepEqual(claims.drafts, [draft, draft]);
  });

  it('reopens a draft by its own claim id without calling it a duplicate', async () => {
    const claims = memoryClaims();
    await claims.store.openDraft('r', 'k', draft);
    assert.deepEqual(await claims.store.openDraft('r', 'k', { ...draft, claimId: 'c2' }), {
      id: 'c2',
      duplicate: false
    });
  });

  it('records assigned patients', async () => {
    const claims = memoryClaims();
    await claims.store.assignPatient('r', 'c1', 'k', 'p1');
    assert.deepEqual(claims.patients, ['p1']);
  });

  it('keeps a ledger from the configured coverages and recorded events', async () => {
    const coverages = [{ id: 'cov-1', payer: 'Medicare' }];
    const claims = memoryClaims({ totalCents: 500, coverages, signalsSeen: 2, reference: 'R-1' });
    await claims.store.recordEvent('r', 'c1', 'k', approved);
    const event = {
      ...approved,
      key: 'k',
      paidCents: 0,
      adjustedCents: 0,
      paidOn: null,
      adjustments: [],
      at: '2026-01-01T00:00:00.000Z'
    };
    assert.deepEqual(claims.events, [event]);
    assert.deepEqual(await claims.store.ledger('r', 'c1'), {
      totalCents: 500,
      coverages,
      events: [event],
      signalsSeen: 2,
      reference: 'R-1'
    });
  });

  it('has no ledger for another claim', async () => {
    assert.equal(await memoryClaims().store.ledger('r', 'c9'), null);
  });

  it('fails statement and submission reads unless they are configured', async () => {
    const { store } = memoryClaims();
    await assert.rejects(() => store.statementData('r', 'c1'), {
      message: 'The statement store is not used here'
    });
    await assert.rejects(() => store.submission('r', 'c1', 'cov-1'), {
      message: 'The submission store is not used here'
    });
  });

  it('records saved statements under their source key', async () => {
    const claims = memoryClaims();
    const pdf = new Uint8Array([1]);
    const terms = { number: 1, count: 3 };
    await claims.store.saveStatement('r', 'c1', 'k', { terms, pdf });
    assert.deepEqual(claims.statements, [{ key: 'k', terms, pdf }]);
  });

  it('reports the first status change stale only when asked to', async () => {
    const stale = memoryClaims({ stale: true });
    assert.equal(await stale.store.setStatus('r', 'c1', 'k', 'ready', 0), 'stale');
    assert.equal(await stale.store.setStatus('r', 'c1', 'k', 'ready', 0), 'set');
    assert.deepEqual(stale.statuses, ['ready', 'ready']);
    assert.equal(await memoryClaims().store.setStatus('r', 'c1', 'k', 'ready', 0), 'set');
  });

  it('files submissions with the control number it hands out', async () => {
    const claims = memoryClaims({ saving: { controlNumber: 42 } });
    const saved = await claims.store.saveSubmission('r', 'c1', 'k', {
      coverageId: 'cov-1',
      resubmission: true,
      totalCents: 100,
      production: false,
      build: (n) => `ISA*${n}~`
    });
    assert.deepEqual(saved, { controlNumber: 42 });
    assert.deepEqual(claims.filed, [
      { key: 'k', coverageId: 'cov-1', resubmission: true, file: 'ISA*42~' }
    ]);
  });

  it('files nothing when saving the submission is refused', async () => {
    const claims = memoryClaims({ saving: 'stale' });
    const saved = await claims.store.saveSubmission('r', 'c1', 'k', {
      coverageId: 'cov-1',
      resubmission: false,
      totalCents: 100,
      production: false,
      build: () => assert.fail('built a refused submission')
    });
    assert.equal(saved, 'stale');
    assert.deepEqual(claims.filed, []);
  });

  it('records sent claim files only when sending is not manual', async () => {
    const manual = memoryClaims();
    assert.equal(await manual.store.sendClaimFile('r', 'c1', 7), 'manual');
    assert.deepEqual(manual.sent, []);
    const sending = memoryClaims({ sending: { sentAs: 'f.837' } });
    assert.deepEqual(await sending.store.sendClaimFile('r', 'c1', 7), { sentAs: 'f.837' });
    assert.deepEqual(sending.sent, [7]);
  });

  it('records the revision and answers the configured status and previous report', async () => {
    const previous = { bucket: 'b', key: 'old' };
    const claims = memoryClaims({ status: 'submitted', previous });
    const report = { bucket: 'b', key: 'new' };
    assert.deepEqual(await claims.store.noteRevision('r', 'c1', 'k', report), {
      status: 'submitted',
      previous
    });
    assert.deepEqual(claims.revisions, [report]);
  });
});
