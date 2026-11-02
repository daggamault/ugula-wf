import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NodeDef, Values } from '@ugula/graph';
import { invokeNode } from '@ugula/graph/testing';
import { billingStores, memoryClaims, memoryFees } from '../testing.ts';
import { claimNodes } from './claims.ts';
import type { ClaimStore } from './stores.ts';

const fees = memoryFees((payer, code) =>
  code === 'A0999' ? null : payer === 'p-medicare' && code === 'A0427' ? 50000 : 95000
).store;

const nodesFor = (claims: ClaimStore = memoryClaims().store) => {
  const stores = billingStores({ fees, claims });
  const nodes = claimNodes(() => stores);
  return (type: string): NodeDef => {
    const found = nodes.find((n) => n.type === `billing.${type}`);
    if (!found) throw new Error(`No ${type} node`);
    return found;
  };
};

const run = (node: NodeDef, inputs: Values) => invokeNode(node, { inputs });

const jane = { id: 'p1', firstName: 'Jane', lastName: 'Doe' };

const claim = {
  pcrNumber: ' PCR-1 ',
  patientId: jane.id,
  serviceDate: '2026-10-01T08:15:00Z',
  level: 'ALS1',
  emergency: true,
  loadedMiles: 12.4,
  lines: [{ code: 'A0427', units: 1, unitCents: 100_000, totalCents: 100_000 }],
  totalCents: 100_000,
  diagnoses: ['R07.9'],
  coverages: [
    { payer: 'Blue', priority: '2611005' },
    { payer: 'Medicare', priority: '2611003', memberId: 'M1' },
    { payer: ' ' }
  ],
  report: { bucket: 'ugula', key: 'imports/t/f.xml.reports/00000.json' }
};

describe('claimNodes', () => {
  it('prices claim lines with payer-specific fees and faults on unscheduled codes', async () => {
    const price = nodesFor()('price-claim');
    const lines = [
      { code: 'A0427', units: 1 },
      { code: 'A0425', units: 2.5 }
    ];
    assert.deepEqual((await run(price, { lines, payerId: 'p-medicare' })).outputs, {
      lines: [
        { code: 'A0427', units: 1, unitCents: 50000, totalCents: 50000 },
        { code: 'A0425', units: 2.5, unitCents: 95000, totalCents: 237500 }
      ],
      totalCents: 287500
    });
    await assert.rejects(
      async () => run(price, { lines: [{ code: 'A0999', units: 1 }] }),
      /No fee scheduled for A0999/
    );
  });

  it('validates, opens and saves a draft claim, and flags duplicates', async () => {
    const claims = memoryClaims();
    const node = nodesFor(claims.store);
    const [validate, open, save] = ['validate-claim', 'open-claim', 'save-claim'].map(node);
    if (!validate || !open || !save) throw new Error('Missing claim nodes');
    const valid = await run(validate, { claim });
    assert.deepEqual([valid.pin, valid.outputs], ['valid', { issues: [] }]);
    const invalid = await run(validate, { claim: { ...claim, totalCents: 5, level: 'X' } });
    assert.equal(invalid.pin, 'invalid');
    assert.equal((invalid.outputs.issues as string[]).length, 2);
    const draftInputs = { patient: jane, pcrNumber: ' PCR-1 ', report: claim.report };
    const opened = await run(open, draftInputs);
    assert.deepEqual([opened.pin, opened.outputs], ['opened', { claimId: 'c1' }]);
    assert.deepEqual(claims.drafts, [
      { patientId: jane.id, pcrNumber: 'PCR-1', reportKey: 'imports/t/f.xml.reports/00000.json' }
    ]);
    await assert.rejects(async () => run(open, { ...draftInputs, patient: {} }), /needs a patient/);
    await assert.rejects(
      async () => run(open, { ...draftInputs, patient: null }),
      /Input "patient" of "Open Draft Claim" is required/
    );
    await run(save, { claimId: 'c1', claim });
    const [saved] = claims.saved;
    assert.deepEqual(
      saved?.coverages.map((c) => c.payer),
      ['Medicare', 'Blue']
    );
    assert.equal(saved?.reportKey, 'imports/t/f.xml.reports/00000.json');
    assert.equal(saved?.pcrNumber, 'PCR-1');
    assert.equal(saved?.coverages[0]?.memberId, 'M1');
    assert.deepEqual(saved?.details.diagnoses, ['R079']);
    assert.equal(saved?.details.serviceDate, '2026-10-01');
    await assert.rejects(
      async () => run(save, { claimId: 'c1', claim: { ...claim, level: null } }),
      /level of service/
    );
    await assert.rejects(async () => run(save, { claimId: ' ', claim }), /No claim to work on/);
    const again = await run(open, draftInputs);
    assert.deepEqual([again.pin, again.outputs], ['duplicate', { claimId: 'c1' }]);
  });

  it('finds claims already billed for a PCR and notes revisions on them', async () => {
    const claims = memoryClaims({ pcrNumbers: { 'PCR-1': 'c1' } });
    const node = nodesFor(claims.store);
    const find = node('find-claim');
    const found = await run(find, { pcrNumber: ' PCR-1 ' });
    assert.deepEqual([found.pin, found.outputs], ['found', { claimId: 'c1' }]);
    assert.equal((await run(find, { pcrNumber: 'PCR-2' })).pin, 'new');
    assert.equal((await run(find, {})).pin, 'new');
    const report = { bucket: 'ugula', key: 'imports/t/g.xml.reports/00000.json' };
    await run(node('note-revision'), { claimId: 'c1', report });
    assert.deepEqual(claims.revisions, [report]);
    await assert.rejects(
      async () => run(node('note-revision'), { claimId: 'c1', report: { bucket: 'ugula' } }),
      /needs a key/
    );
  });
});
