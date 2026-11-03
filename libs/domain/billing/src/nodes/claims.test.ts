import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NodeDef, Values } from '@ugula/graph';
import { invokeNode } from '@ugula/graph/testing';
import {
  billingStores,
  completeCheck,
  memoryClaims,
  memoryFees,
  memoryPayers
} from '../testing.ts';
import { claimNodes } from './claims.ts';
import type { ClaimStore } from './stores.ts';

const feesFor = () =>
  memoryFees((payer, code) =>
    code === 'A0999' ? null : payer === 'p-medicare' && code === 'A0427' ? 50000 : 95000
  );

const medicare = { id: 'p-Medicare', name: 'Medicare', claimFiling: 'MB' };

const nodesFor = (claims: ClaimStore = memoryClaims().store, fees = feesFor().store) => {
  const stores = billingStores({
    fees,
    claims,
    payers: memoryPayers({ Medicare: medicare }).store
  });
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
  tripType: 'emergency',
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
  it('prices claim lines with payer-specific fees and names the codes without a fee', async () => {
    const fees = feesFor();
    const node = nodesFor(memoryClaims().store, fees.store);
    const price = node('price-claim');
    const lines = [
      { code: 'A0427', units: 1 },
      { code: 'A0425', units: 2.5 }
    ];
    assert.deepEqual((await run(price, { lines, payerId: 'p-medicare' })).outputs, {
      lines: [
        { code: 'A0427', units: 1, unitCents: 50000, totalCents: 50000 },
        { code: 'A0425', units: 2.5, unitCents: 95000, totalCents: 237500 }
      ],
      totalCents: 287500,
      missing: []
    });
    const unscheduled = [{ code: 'A0999', units: 1 }];
    const missing = await run(price, { lines: unscheduled });
    assert.deepEqual([missing.pin, missing.outputs.missing], ['unpriced', ['A0999']]);
    const set = await run(node('set-fee'), { code: 'A0999', unitPrice: 12.345 });
    assert.deepEqual(set.outputs.fees, { A0999: 1235 });
    const priced = await run(price, { lines: unscheduled, fees: set.outputs.fees });
    assert.deepEqual([priced.pin, priced.outputs.totalCents], ['priced', 1235]);
    assert.deepEqual(fees.saved, []);
    await run(node('set-fee'), { code: 'A0999', unitPrice: 20, saveToSchedule: true });
    assert.deepEqual(fees.saved, [[null, 'A0999', 2000]]);
    await assert.rejects(
      async () => run(node('set-fee'), { code: 'A0999', unitPrice: -1 }),
      /cannot be negative/
    );
  });

  it('opens a draft claim before the patient is known, or works an existing one again', async () => {
    const claims = memoryClaims();
    const node = nodesFor(claims.store);
    const draftInputs = { pcrNumber: ' PCR-1 ', report: claim.report };
    const opened = await run(node('open-claim'), draftInputs);
    assert.deepEqual([opened.pin, opened.outputs], ['opened', { claimId: 'c1' }]);
    assert.deepEqual(claims.drafts, [
      { pcrNumber: 'PCR-1', reportKey: 'imports/t/f.xml.reports/00000.json', claimId: null }
    ]);
    const again = await run(node('open-claim'), draftInputs);
    assert.deepEqual([again.pin, again.outputs], ['duplicate', { claimId: 'c1' }]);
    const restarted = await run(node('open-claim'), { ...draftInputs, claimId: 'c7' });
    assert.deepEqual([restarted.pin, restarted.outputs], ['opened', { claimId: 'c7' }]);
    await run(node('assign-patient'), { claimId: 'c1', patient: jane });
    assert.deepEqual(claims.patients, [jane.id]);
    await assert.rejects(
      async () => run(node('assign-patient'), { claimId: 'c1', patient: {} }),
      /The patient has no id/
    );
    await assert.rejects(
      async () => run(node('assign-patient'), { claimId: ' ', patient: jane }),
      /No claim to work on/
    );
  });

  it('saves a draft claim and validates it with the submission checks', async () => {
    const claims = memoryClaims();
    const node = nodesFor(claims.store);
    const [validate, save] = ['validate-claim', 'save-claim'].map(node);
    if (!validate || !save) throw new Error('Missing claim nodes');
    await run(save, { claimId: 'c1', claim });
    const [saved] = claims.saved;
    assert.deepEqual(
      saved?.coverages.map((c) => c.payer),
      ['Medicare', 'Blue']
    );
    assert.equal(saved?.reportKey, 'imports/t/f.xml.reports/00000.json');
    assert.equal(saved?.tripType, 'emergency');
    assert.equal(saved?.coverages[0]?.memberId, 'M1');
    assert.deepEqual(saved?.details.diagnoses, ['R079']);
    const invalid = await run(validate, { claimId: 'c1' });
    assert.equal(invalid.pin, 'invalid');
    assert.ok(
      (invalid.outputs.visible as string[]).includes('pickupAddressLine') &&
        (invalid.outputs.visible as string[]).includes('coverageId')
    );
    assert.deepEqual(invalid.outputs.options, {
      coverageId: [
        { value: 'cov-Medicare', label: 'Medicare · M1' },
        { value: 'cov-Blue', label: 'Blue' }
      ],
      payerId: [{ value: 'p-Medicare', label: 'Medicare (Medicare Part B)' }]
    });
    await assert.rejects(
      async () => run(save, { claimId: 'c1', claim: { ...claim, level: null } }),
      /level of service/
    );
    await assert.rejects(async () => run(validate, { claimId: 'c9' }), /does not exist/);
  });

  it('passes a complete claim, and offers every field when asked to', async () => {
    const node = nodesFor(memoryClaims({ check: completeCheck() }).store);
    const valid = await run(node('validate-claim'), { claimId: 'c1' });
    assert.deepEqual(
      [valid.pin, valid.outputs.issues, valid.outputs.visible],
      ['valid', [], ['note']]
    );
    const all = await run(node('validate-claim'), { claimId: 'c1', all: true });
    assert.ok((all.outputs.visible as string[]).includes('serviceDate'));
    assert.equal((all.outputs.defaults as { serviceDate: string }).serviceDate, '2025-12-30');
  });

  it('patches the claim from a fix task and asks for repricing when charges change', async () => {
    const check = completeCheck();
    const claims = memoryClaims({
      check: { ...check, details: { ...check.details, serviceDate: null, diagnoses: [] } }
    });
    const node = nodesFor(claims.store);
    const patch = node('patch-claim');
    const dated = await run(patch, {
      claimId: 'c1',
      serviceDate: '2025-12-29',
      diagnoses: ['r07.9'],
      pickupPostalCode: '62704',
      note: 'From the run sheet'
    });
    assert.equal(dated.pin, 'patched');
    assert.equal(claims.current()?.details.serviceDate, '2025-12-29');
    assert.deepEqual(claims.current()?.details.diagnoses, ['R079']);
    assert.equal(claims.current()?.details.pickup.postalCode, '62704');
    assert.equal(claims.current()?.details.pickup.addressLine, '9 Oak Ave');
    assert.equal(claims.events.at(-1)?.kind, 'edited');
    const repriced = await run(patch, {
      claimId: 'c1',
      level: 'BLS',
      coverageId: 'cov-Medicare',
      removeCoverage: true
    });
    assert.deepEqual(repriced.pin, 'reprice');
    assert.deepEqual(repriced.outputs, {
      tripType: 'emergency',
      service: { level: 'BLS', emergency: true, loadedMiles: 7.3, basis: [] },
      payerId: 'p-Blue'
    });
    const lines = [{ code: 'A0429', units: 1, unitCents: 70_000, totalCents: 70_000 }];
    await run(patch, { claimId: 'c1', lines });
    assert.equal(claims.current()?.totalCents, 70_000);
  });

  it('notes revisions and says whether the claim can be worked again', async () => {
    const claims = memoryClaims({ status: 'submitted', previous: { bucket: 'b', key: 'old' } });
    const node = nodesFor(claims.store);
    const report = { bucket: 'ugula', key: 'imports/t/g.xml.reports/00000.json' };
    const noted = await run(node('note-revision'), { claimId: 'c1', report });
    assert.deepEqual(
      [noted.pin, noted.outputs],
      ['billed', { status: 'submitted', previous: { bucket: 'b', key: 'old' } }]
    );
    assert.deepEqual(claims.revisions, [report]);
    const draft = memoryClaims({ status: 'void' });
    assert.equal(
      (await run(nodesFor(draft.store)('note-revision'), { claimId: 'c1', report })).pin,
      'restartable'
    );
    await assert.rejects(
      async () => run(node('note-revision'), { claimId: 'c1', report: { bucket: 'ugula' } }),
      /needs a key/
    );
  });
});
