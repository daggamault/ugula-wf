import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type NodeDef, nodeDocumentationIssues, type Values } from '@ugula/graph';
import { invokeNode } from '@ugula/graph/testing';
import type { ClaimInput, ClaimReview } from './claims.ts';
import { createBillingNodes } from './nodes.ts';
import type { Patient } from './patients.ts';
import type { Payer } from './payers.ts';
import type { BillingStores } from './stores.ts';

const JANE: Patient = {
  id: 'p-1',
  firstName: 'Jane',
  lastName: 'Doe',
  birthDate: '1950-02-03',
  gender: 'F',
  addressLine: null,
  city: null,
  state: null,
  postalCode: null
};

const MEDICARE: Payer = {
  id: 'pay-1',
  name: 'Medicare Part B',
  claimFiling: 'MB',
  payerCode: 'DEMOMCR',
  filingLimitDays: 365,
  correctionMethod: 'reopening',
  appealDays: 120,
  planType: 'government'
};

const person = (patch: object = {}) => ({
  firstName: 'Jane',
  lastName: 'Doe',
  birthDate: '1950-02-03',
  sex: '9919001',
  gender: null,
  address: { line: '12 Oak St', city: 'Erie', state: 'PA', postalCode: '16505' },
  ...patch
});

const fakeStores = () => {
  const patients: Patient[] = [JANE];
  const saved: ClaimInput[] = [];
  const addresses: [string, string | null][] = [];
  const reviews: ClaimReview[] = [];
  const searches: [string, number, boolean][] = [];
  const stores: BillingStores = {
    patients: {
      findPatient: async (_, id) => patients.find((p) => p.id === id) ?? null,
      findCandidates: async (_, q) => patients.filter((p) => p.birthDate === q.birthDate),
      createPatient: async (_, key, p) => {
        const created = { ...p, id: `p-${key}` };
        patients.push(created);
        return created;
      },
      updateAddress: async (_, id, a) => {
        addresses.push([id, a.addressLine]);
        return JANE;
      }
    },
    payers: {
      findPayer: async (_, id) => (id === MEDICARE.id ? MEDICARE : null),
      matchPayer: async (_, name) =>
        name === 'MEDICARE'
          ? { known: { id: 'pay-1', name: 'Medicare Part B', claimFiling: 'MB' }, similar: [] }
          : name === 'HIGHMARK'
            ? {
                known: null,
                similar: [
                  { id: 'pay-2', name: 'Highmark BCBS', claimFiling: 'BL', similarity: 0.6 }
                ]
              }
            : { known: null, similar: [] }
    },
    fees: {
      findFee: async (_, payerId, code) =>
        payerId === 'pay-1' && code === 'A0427' ? 70000 : code === 'A0999' ? null : 80000
    },
    claims: {
      findClaim: async (_, id) => {
        const last = saved.at(-1);
        return id === 'c-1' && last ? { ...last, id, revision: saved.length } : null;
      },
      saveClaim: async (_, claim) => {
        saved.push(claim);
        return {
          id: 'c-1',
          revision: saved.length,
          outcome: saved.length > 1 ? 'replaced' : 'created'
        };
      },
      sendClaim: async (_, id) => {
        const last = saved.at(-1);
        if (id !== 'c-1' || !last) return { outcome: 'notApproved' };
        if (!last.coverages.length) return { outcome: 'selfPay' };
        return last.diagnoses.length
          ? { outcome: 'sent', fileName: 'S000000007.CLP', controlNumber: 7 }
          : { outcome: 'notReady', issues: ['The claim has no diagnosis'] };
      },
      checkClaim: async (_, id) =>
        id === 'c-1' ? (saved.at(-1)?.coverages.length ? [] : ['The claim has no payer']) : null,
      reviewClaim: async (_, review) => {
        reviews.push(review);
        if (review.decision === 'approved' && !saved.at(-1)?.coverages.length) return 'notReady';
        return review.revision === saved.length ? 'recorded' : 'superseded';
      }
    },
    diagnoses: {
      findBillable: async (codes) =>
        codes
          .filter((c) => ['R079', 'I214', 'N186'].includes(c))
          .map((code) => ({ code, description: `Code ${code}` })),
      search: async (text, limit, emsOnly) => {
        searches.push([text, limit, emsOnly]);
        return [
          { code: 'R079', description: 'Chest pain, unspecified', score: 0.81 },
          { code: 'R0789', description: 'Other chest pain', score: 0.74 }
        ].slice(0, limit);
      }
    }
  };
  return { stores, patients, saved, addresses, reviews, searches };
};

const run = (stores: BillingStores, type: string, inputs: Values) => {
  const node = createBillingNodes(stores).find((n) => n.type === type);
  if (!node) throw new Error(`No node ${type}`);
  return invokeNode(node as NodeDef, { inputs });
};

describe('createBillingNodes', () => {
  it('documents every pin as a basic node', () => {
    const nodes = createBillingNodes(null);
    assert.deepEqual(nodes.flatMap(nodeDocumentationIssues), []);
    assert.deepEqual(new Set(nodes.map((n) => n.level)), new Set(['basic']));
  });
});

describe('Find Patient', () => {
  it('matches the same person and offers similar ones', async () => {
    const { stores } = fakeStores();
    const matched = await run(stores, 'patient.find', { person: person() });
    assert.deepEqual([matched.pin, matched.outputs.patientId], ['matched', 'p-1']);
    const similar = await run(stores, 'patient.find', { person: person({ lastName: 'Dow' }) });
    assert.deepEqual(
      [similar.pin, similar.outputs.candidates],
      ['similar', [{ patientId: 'p-1', name: 'Doe, Jane', birthDate: '1950-02-03' }]]
    );
  });

  it('finds no one new, and says when there is nothing to look by', async () => {
    const { stores } = fakeStores();
    const none = await run(stores, 'patient.find', { person: person({ birthDate: '1990-01-01' }) });
    assert.equal(none.pin, 'notFound');
    const empty = await run(stores, 'patient.find', {
      person: person({ lastName: null, birthDate: null })
    });
    assert.equal(empty.pin, 'incomplete');
  });
});

describe('Save Patient', () => {
  it('creates a new patient or updates the address of a known one', async () => {
    const { stores, patients, addresses } = fakeStores();
    const created = await run(stores, 'patient.save', { person: person({ firstName: 'Ann' }) });
    assert.equal(patients.at(-1)?.firstName, 'Ann');
    assert.equal(created.outputs.patientId, patients.at(-1)?.id);
    const updated = await run(stores, 'patient.save', { person: person(), patientId: 'p-1' });
    assert.equal(updated.outputs.patientId, 'p-1');
    await run(stores, 'patient.save', { person: person({ address: null }), patientId: 'p-1' });
    assert.deepEqual(addresses, [['p-1', '12 Oak St']]);
    await assert.rejects(
      run(stores, 'patient.save', { person: person({ birthDate: null }) }),
      /needs a first name, last name and birth date/
    );
  });
});

describe('Read Patient', () => {
  it('reads a patient as a record, with the address as its own part', async () => {
    const { stores } = fakeStores();
    await run(stores, 'patient.save', { person: person({ firstName: 'Ann' }) });
    const { outputs } = await run(stores, 'patient.read', { patientId: 'p-key' });
    assert.deepEqual(outputs.patient, {
      id: 'p-key',
      firstName: 'Ann',
      lastName: 'Doe',
      birthDate: '1950-02-03',
      sex: 'F',
      address: { line: '12 Oak St', city: 'Erie', state: 'PA', postalCode: '16505' }
    });
    assert.equal((await run(stores, 'patient.read', { patientId: 'p-key' })).pin, 'found');
    assert.deepEqual(await pinAndOutputs(run(stores, 'patient.read', { patientId: 'p-9' })), [
      'notFound',
      {}
    ]);
  });
});

const pinAndOutputs = async (ran: ReturnType<typeof run>) => {
  const { pin, outputs } = await ran;
  return [pin, outputs];
};

describe('Read Payer', () => {
  it('reads a directory payer with its billing rules', async () => {
    const { stores } = fakeStores();
    assert.deepEqual((await run(stores, 'payer.read', { payerId: 'pay-1' })).outputs, {
      payer: MEDICARE
    });
    assert.deepEqual(await pinAndOutputs(run(stores, 'payer.read', { payerId: 'pay-9' })), [
      'notFound',
      {}
    ]);
  });
});

describe('Find Payer', () => {
  it('finds a payer by name, offers similar ones or finds none', async () => {
    const { stores } = fakeStores();
    const found = await run(stores, 'payer.find', { name: 'MEDICARE' });
    assert.deepEqual(
      [found.pin, found.outputs],
      ['found', { payerId: 'pay-1', payerName: 'Medicare Part B', claimFiling: 'MB' }]
    );
    const similar = await run(stores, 'payer.find', { name: 'HIGHMARK' });
    assert.deepEqual(
      [similar.pin, similar.outputs.candidates],
      ['similar', [{ payerId: 'pay-2', payerName: 'Highmark BCBS', similarity: 0.6 }]]
    );
    assert.equal((await run(stores, 'payer.find', { name: 'ACME' })).pin, 'notFound');
  });
});

describe('Find Fee', () => {
  it('prefers the fee of the payer, then the standard fee', async () => {
    const { stores } = fakeStores();
    const own = await run(stores, 'fee.find', { code: 'A0427', payerId: 'pay-1' });
    assert.deepEqual([own.pin, own.outputs.unitCents], ['found', 70000]);
    const standard = await run(stores, 'fee.find', { code: 'A0425' });
    assert.deepEqual([standard.pin, standard.outputs.unitCents], ['found', 80000]);
    assert.equal((await run(stores, 'fee.find', { code: 'A0999' })).pin, 'notFound');
  });
});

const CLAIM = {
  encounterId: 'e-1',
  patientId: 'p-1',
  classification: 'emergency',
  level: 'BLS',
  emergency: true,
  coverages: [{ payerName: 'Medicare', relationship: '18' }],
  lines: [{ code: 'A0429', units: 1, unitCents: 50000, totalCents: 50000 }]
};

describe('Send Claim', () => {
  it('sends an approved claim, or says why it did not', async () => {
    const { stores } = fakeStores();
    await run(stores, 'claim.save', { claim: { ...CLAIM, diagnoses: ['R079'] } });
    const sent = await run(stores, 'claim.send', { claimId: 'c-1' });
    assert.deepEqual(
      [sent.pin, sent.outputs.fileName, sent.outputs.controlNumber],
      ['sent', 'S000000007.CLP', 7]
    );
    await run(stores, 'claim.save', { claim: CLAIM });
    const lacking = await run(stores, 'claim.send', { claimId: 'c-1' });
    assert.deepEqual(
      [lacking.pin, lacking.outputs.issues],
      ['notReady', ['The claim has no diagnosis']]
    );
    await run(stores, 'claim.save', { claim: { ...CLAIM, coverages: [] } });
    assert.equal((await run(stores, 'claim.send', { claimId: 'c-1' })).pin, 'selfPay');
    assert.equal((await run(stores, 'claim.send', { claimId: 'c-9' })).pin, 'notApproved');
  });
});

describe('Check Claim', () => {
  it('says whether a saved claim can be sent, and what it lacks', async () => {
    const { stores } = fakeStores();
    await run(stores, 'claim.save', { claim: CLAIM });
    const ready = await run(stores, 'claim.check', { claimId: 'c-1' });
    assert.deepEqual([ready.pin, ready.outputs.issues], ['ready', []]);
    await run(stores, 'claim.save', { claim: { ...CLAIM, coverages: [] } });
    const lacking = await run(stores, 'claim.check', { claimId: 'c-1' });
    assert.deepEqual(
      [lacking.pin, lacking.outputs.issues],
      ['notReady', ['The claim has no payer']]
    );
    await assert.rejects(run(stores, 'claim.check', { claimId: 'c-9' }), /Claim c-9 was not found/);
  });
});

describe('Record Claim Review', () => {
  const review = { claimId: 'c-1', decision: 'approved', reviewedBy: 'u-1' };

  it('records the decision on the revision the biller saw, and not on a later one', async () => {
    const { stores, reviews } = fakeStores();
    await run(stores, 'claim.save', { claim: CLAIM });
    assert.equal((await run(stores, 'claim.review', { ...review, revision: 1 })).pin, 'recorded');
    await run(stores, 'claim.save', { claim: CLAIM });
    const held = { ...review, revision: 1, decision: 'on_hold', note: ' Need the PCS ' };
    assert.equal((await run(stores, 'claim.review', held)).pin, 'superseded');
    assert.deepEqual(reviews, [
      { ...review, revision: 1, note: null },
      { ...held, note: 'Need the PCS' }
    ]);
  });

  it('does not approve a claim that lacks something the 837P needs', async () => {
    const { stores } = fakeStores();
    await run(stores, 'claim.save', { claim: { ...CLAIM, coverages: [] } });
    assert.equal((await run(stores, 'claim.review', { ...review, revision: 1 })).pin, 'notReady');
  });

  it('refuses a hold without a note and a review without a biller', async () => {
    const { stores } = fakeStores();
    await assert.rejects(
      run(stores, 'claim.review', { ...review, revision: 1, decision: 'on_hold' }),
      /needs a note/
    );
    await assert.rejects(
      run(stores, 'claim.review', { ...review, revision: 1, reviewedBy: ' ' }),
      /biller who reviewed/
    );
    await assert.rejects(
      run(stores, 'claim.review', { ...review, revision: 1, decision: 'sent' }),
      /sent is not a decision/
    );
  });
});

describe('Save Claim', () => {
  it('saves a valid claim and replaces it on the next save', async () => {
    const { stores, saved } = fakeStores();
    const claim = CLAIM;
    const first = await run(stores, 'claim.save', { claim });
    assert.deepEqual(
      [first.pin, first.outputs.claimId, first.outputs.revision],
      ['created', 'c-1', 1]
    );
    const second = await run(stores, 'claim.save', { claim });
    assert.deepEqual([second.pin, second.outputs.revision], ['replaced', 2]);
    assert.equal(saved[0]?.totalCents, 50000);
    await assert.rejects(
      run(stores, 'claim.save', { claim: { ...claim, level: 'ALS9' } }),
      /ALS9 is not a level of service/
    );
  });
});

describe('Read Claim', () => {
  it('reads the latest revision of a saved claim as a Claim', async () => {
    const { stores } = fakeStores();
    await run(stores, 'claim.save', { claim: CLAIM });
    await run(stores, 'claim.save', { claim: { ...CLAIM, emergency: false } });
    const { claim } = (await run(stores, 'claim.read', { claimId: 'c-1' })).outputs;
    assert.deepEqual(
      [
        (claim as { id: string }).id,
        (claim as { revision: number }).revision,
        (claim as { emergency: boolean }).emergency
      ],
      ['c-1', 2, false]
    );
    assert.deepEqual(await pinAndOutputs(run(stores, 'claim.read', { claimId: 'c-9' })), [
      'notFound',
      {}
    ]);
  });
});

describe('Check Diagnoses', () => {
  it('writes codes without the dot and splits billable ones from the rest', async () => {
    const { stores } = fakeStores();
    assert.deepEqual(
      (await run(stores, 'diagnosis.check', { codes: ['R07.9', 'I21', 'r079', null, 'N18.6'] }))
        .outputs,
      { billable: ['R079', 'N186'], rejected: ['I21'] }
    );
  });

  it('checks nothing when no code is given', async () => {
    const { stores } = fakeStores();
    assert.deepEqual((await run(stores, 'diagnosis.check', { codes: null })).outputs, {
      billable: [],
      rejected: []
    });
  });
});

describe('Search Diagnoses', () => {
  it('gives the closest codes, best first, within the limit', async () => {
    const { stores, searches } = fakeStores();
    assert.deepEqual(
      (await run(stores, 'diagnosis.search', { text: ' chest pain ', limit: 1 })).outputs,
      {
        matches: [{ code: 'R079', description: 'Chest pain, unspecified', score: 0.81 }],
        best: 'R079',
        bestScore: 0.81
      }
    );
    assert.deepEqual(searches, [['chest pain', 1, true]]);
    await run(stores, 'diagnosis.search', { text: 'hip fracture', emsOnly: false });
    assert.deepEqual(searches.at(-1), ['hip fracture', 5, false]);
  });

  it('searches nothing for an empty text', async () => {
    const { stores, searches } = fakeStores();
    assert.deepEqual((await run(stores, 'diagnosis.search', { text: '  ' })).outputs, {
      matches: [],
      best: null,
      bestScore: null
    });
    assert.deepEqual(searches, []);
  });
});
