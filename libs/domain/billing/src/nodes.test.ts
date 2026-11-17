import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type NodeDef, nodeDocumentationIssues, type Values } from '@ugula/graph';
import { invokeNode } from '@ugula/graph/testing';
import type { ClaimInput } from './claims.ts';
import { createBillingNodes } from './nodes.ts';
import type { Patient } from './patients.ts';
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
  const stores: BillingStores = {
    patients: {
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
      findPayer: async (_, name) =>
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
      findSchedules: async (_, payerId, codes) => ({
        payer: payerId === 'pay-1' ? { A0427: 70000 } : {},
        default: Object.fromEntries(codes.filter((c) => c !== 'A0999').map((c) => [c, 80000]))
      })
    },
    claims: {
      saveClaim: async (_, claim) => {
        saved.push(claim);
        return { id: 'c-1', outcome: saved.length > 1 ? 'replaced' : 'created' };
      }
    }
  };
  return { stores, patients, saved, addresses };
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

describe('Save Claim', () => {
  it('saves a valid claim and replaces it on the next save', async () => {
    const { stores, saved } = fakeStores();
    const claim = {
      encounterId: 'e-1',
      patientId: 'p-1',
      classification: 'emergency',
      level: 'BLS',
      emergency: true,
      lines: [{ code: 'A0429', units: 1, unitCents: 50000, totalCents: 50000 }]
    };
    const first = await run(stores, 'claim.save', { claim });
    assert.deepEqual([first.pin, first.outputs.claimId], ['created', 'c-1']);
    assert.equal((await run(stores, 'claim.save', { claim })).pin, 'replaced');
    assert.equal(saved[0]?.totalCents, 50000);
    await assert.rejects(
      run(stores, 'claim.save', { claim: { ...claim, level: 'ALS9' } }),
      /ALS9 is not a level of service/
    );
  });
});
