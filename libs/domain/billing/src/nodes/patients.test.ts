import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NodeDef, Values } from '@ugula/graph';
import { invokeNode } from '@ugula/graph/testing';
import type { Patient } from '../patients.ts';
import { billingStores, memoryPatients } from '../testing.ts';
import { patientNodes } from './patients.ts';
import type { PatientStore } from './stores.ts';

const jane: Patient = {
  id: 'p1',
  firstName: 'Jane',
  lastName: 'Doe',
  birthDate: '1980-01-02',
  gender: null,
  addressLine: null,
  city: null,
  state: null,
  postalCode: null
};

const nodeFor = (patients: PatientStore, type: string): NodeDef => {
  const stores = billingStores({ patients });
  const found = patientNodes(() => stores).find((n) => n.type === `billing.${type}`);
  if (!found) throw new Error(`No ${type} node`);
  return found;
};

const run = (node: NodeDef, inputs: Values) => invokeNode(node, { inputs });

const demographics = { firstName: 'Jane', lastName: ' doe', birthDate: '1980-01-02' };

const cleaned = {
  ...demographics,
  lastName: 'doe',
  gender: null,
  addressLine: null,
  city: null,
  state: null,
  postalCode: null
};

describe('patientNodes', () => {
  it('routes report demographics to matched, unmatched or review', async () => {
    const { store, calls } = memoryPatients([jane]);
    const match = nodeFor(store, 'match-patient');
    const matched = await run(match, { demographics });
    assert.equal(matched.pin, 'matched');
    assert.deepEqual(matched.outputs, {
      patient: jane,
      candidates: [],
      reason: '',
      demographics: cleaned
    });
    assert.deepEqual(calls[0], [
      'findCandidates',
      'run',
      { birthDate: '1980-01-02', lastNameKey: 'doe', firstName: 'Jane' }
    ]);
    const review = await run(match, { demographics: { lastName: 'Doe', birthDate: null } });
    assert.equal(review.pin, 'review');
    assert.deepEqual(review.outputs.demographics, {
      firstName: null,
      lastName: 'Doe',
      birthDate: null,
      gender: null,
      addressLine: null,
      city: null,
      state: null,
      postalCode: null
    });
    assert.deepEqual(review.outputs.candidates, []);
    const fresh = nodeFor(memoryPatients([]).store, 'match-patient');
    assert.equal((await run(fresh, { demographics })).pin, 'unmatched');
  });

  it('creates patients idempotently per step and loads chosen ones', async () => {
    const { store, calls } = memoryPatients([jane]);
    const create = nodeFor(store, 'create-patient');
    const find = nodeFor(store, 'find-patient');
    const created = await run(create, { demographics });
    assert.deepEqual(created.outputs.patient, { id: 'new', ...cleaned });
    assert.deepEqual(calls.at(-1), ['createPatient', 'run', 'key', false]);
    await run(create, { demographics, reuseMatch: true });
    assert.deepEqual(calls.at(-1), ['createPatient', 'run', 'key', true]);
    await assert.rejects(
      async () => run(create, { demographics: { lastName: 'Doe' } }),
      /needs a first name, last name and valid birth date/
    );
    assert.deepEqual((await run(find, { patientId: 'p1' })).outputs, { patient: jane });
    await assert.rejects(async () => run(find, { patientId: 'p9' }), /does not exist/);
    await assert.rejects(async () => run(find, { patientId: ' ' }), /Choose a patient/);
    await assert.rejects(async () => run(find, {}), /Input "patientId" of "Find Patient"/);
  });
});
