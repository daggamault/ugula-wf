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

const lines = [
  { code: 'A0427', units: 1 },
  { code: 'A0425', units: 2.5 }
];

describe('claimNodes', () => {
  it('finds the payer and default fee schedules separately, for Price Precedence to choose', async () => {
    const node = nodesFor();
    assert.deepEqual((await run(node('find-fees'), { lines, payerId: 'p-medicare' })).outputs, {
      payerFees: { A0427: 50000, A0425: 95000 },
      defaultFees: { A0427: 95000, A0425: 95000 }
    });
    assert.deepEqual((await run(node('find-fees'), { lines })).outputs.payerFees, {});
  });

  it('prices lines at the chosen fees and names the codes without one', async () => {
    const price = nodesFor()('price-lines');
    assert.deepEqual((await run(price, { lines, fees: { A0427: 50000, A0425: 1000 } })).outputs, {
      lines: [
        { code: 'A0427', units: 1, unitCents: 50000, totalCents: 50000 },
        { code: 'A0425', units: 2.5, unitCents: 1000, totalCents: 2500 }
      ],
      totalCents: 52500,
      missing: []
    });
    const partial = await run(price, { lines, fees: { A0427: -5, A0425: 12.5 } });
    assert.deepEqual(partial.outputs.missing, ['A0427', 'A0425']);
  });

  it('keeps prices a biller sets for the claim, and saves them to the schedule on request', async () => {
    const fees = feesFor();
    const node = nodesFor(memoryClaims().store, fees.store);
    const set = await run(node('set-fee'), { code: 'A0999', unitPrice: 12.345 });
    assert.deepEqual(set.outputs.fees, { A0999: 1235 });
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
  it('saves a draft claim and reads it back as check facts', async () => {
    const claims = memoryClaims();
    const node = nodesFor(claims.store);
    await run(node('save-claim'), { claimId: 'c1', claim });
    const [saved] = claims.saved;
    assert.deepEqual(
      saved?.coverages.map((c) => c.payer),
      ['Medicare', 'Blue']
    );
    assert.equal(saved?.reportKey, 'imports/t/f.xml.reports/00000.json');
    assert.equal(saved?.tripType, 'emergency');
    assert.equal(saved?.coverages[0]?.memberId, 'M1');
    assert.deepEqual(saved?.details.diagnoses, ['R079']);
    const read = await run(node('read-claim-checks'), { claimId: 'c1' });
    const facts = read.outputs.facts as { diagnosisCount: number; pickupMissing: string[] };
    assert.equal(facts.diagnosisCount, 1);
    assert.deepEqual(facts.pickupMissing, ['street address', 'city', 'state', 'ZIP code']);
    assert.deepEqual(read.outputs.skipped, []);
    await assert.rejects(
      async () => run(node('save-claim'), { claimId: 'c1', claim: { ...claim, level: null } }),
      /level of service/
    );
    await assert.rejects(
      async () => run(node('read-claim-checks'), { claimId: 'c9' }),
      /does not exist/
    );
  });

  it('lists the payers already skipped, whose issues no longer matter', async () => {
    const claims = memoryClaims({ check: completeCheck() });
    claims.events.push({
      kind: 'payer_skipped',
      coverageId: 'cov-Blue',
      key: 'skip',
      note: '',
      paidCents: 0,
      adjustedCents: 0,
      payerClaimNumber: null,
      paidOn: null,
      adjustments: [],
      at: '2026-01-01T00:00:00.000Z'
    });
    const read = await run(nodesFor(claims.store)('read-claim-checks'), { claimId: 'c1' });
    assert.deepEqual(read.outputs.skipped, ['cov-Blue']);
  });

  it('lays out the fix form from the fields the issues name, or every field', async () => {
    const node = nodesFor(memoryClaims({ check: completeCheck() }).store);
    const issue = {
      code: 'member-id-missing',
      severity: 'blocking',
      field: 'memberId',
      message: 'The member ID for Blue is missing',
      coverageId: 'cov-Blue'
    };
    const form = await run(node('fix-claim-form'), { claimId: 'c1', issues: [issue] });
    assert.ok((form.outputs.visible as string[]).includes('memberId'));
    assert.equal((form.outputs.defaults as { coverageId: string }).coverageId, 'cov-Blue');
    assert.deepEqual((form.outputs.options as { payerId: unknown }).payerId, [
      { value: 'p-Medicare', label: 'Medicare (Medicare Part B)' }
    ]);
    const none = await run(node('fix-claim-form'), { claimId: 'c1', issues: [] });
    assert.deepEqual(none.outputs.visible, ['note']);
    const all = await run(node('fix-claim-form'), { claimId: 'c1', issues: [], all: true });
    assert.ok((all.outputs.visible as string[]).includes('serviceDate'));
    assert.equal((all.outputs.defaults as { serviceDate: string }).serviceDate, '2025-12-30');
  });

  it('patches the claim from a fix task and says what changed for the reprice rule', async () => {
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
    assert.deepEqual(dated.outputs.changes, {
      tripType: false,
      level: false,
      emergency: false,
      loadedMiles: false,
      deceased: false,
      nonCoveredMiles: false,
      payers: false
    });
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
    assert.deepEqual(repriced.outputs, {
      changes: {
        tripType: false,
        level: true,
        emergency: false,
        loadedMiles: false,
        deceased: false,
        nonCoveredMiles: false,
        payers: true
      },
      tripType: 'emergency',
      service: {
        level: 'BLS',
        emergency: true,
        loadedMiles: 7.3,
        basis: [],
        deceased: false,
        nonCoveredMiles: null
      },
      payerId: 'p-Blue'
    });
    const repricedLines = [{ code: 'A0429', units: 1, unitCents: 70_000, totalCents: 70_000 }];
    await run(patch, { claimId: 'c1', lines: repricedLines });
    assert.equal(claims.current()?.totalCents, 70_000);
  });

  it('records who a claim is billed to, and lists the facility directory as choices', async () => {
    const claims = memoryClaims({
      facilities: [{ id: 'f1', name: 'Oak Manor', kind: 'snf', contract: true }]
    });
    const node = nodesFor(claims.store);
    assert.deepEqual((await run(node('facility-choices'), {})).outputs, {
      options: {
        facilityId: [{ value: 'f1', label: 'Oak Manor · Skilled nursing facility · contract' }]
      }
    });
    assert.deepEqual((await run(nodesFor()('facility-choices'), {})).outputs, { options: null });
    await run(node('record-responsibility'), {
      claimId: 'c1',
      party: 'facility',
      facilityId: 'f1'
    });
    await run(node('record-responsibility'), { claimId: 'c1', party: 'payer', facilityId: 'f1' });
    assert.deepEqual(claims.responsibilities, [
      { party: 'facility', facilityId: 'f1', note: 'Billed to the facility' },
      { party: 'payer', facilityId: null, note: 'Billed to the payers' }
    ]);
    await assert.rejects(
      async () => run(node('record-responsibility'), { claimId: 'c1', party: 'patient' }),
      /Unknown responsible party/
    );
  });

  it('reads a document uploaded to the claim', async () => {
    const pcs = { id: 'd1', kind: 'pcs' as const, signedOn: '2026-01-02', fileName: 'pcs.pdf' };
    const node = nodesFor(memoryClaims({ documents: [pcs] }).store);
    assert.deepEqual(
      (await run(node('read-claim-document'), { claimId: 'c1', documentId: 'd1' })).outputs,
      { document: pcs }
    );
    await assert.rejects(
      async () => run(node('read-claim-document'), { claimId: 'c1', documentId: 'd2' }),
      /is not on claim c1/
    );
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
