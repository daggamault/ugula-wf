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
  it('routes report demographics to matched, unmatched, review or incomplete', async () => {
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
    assert.equal(review.pin, 'incomplete');
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
    const twin = { ...jane, id: 'p2' };
    const shared = nodeFor(memoryPatients([jane, twin]).store, 'match-patient');
    const both = await run(shared, { demographics });
    assert.deepEqual(
      [both.pin, both.outputs.patient, both.outputs.candidates, both.outputs.reason],
      ['review', null, [jane, twin], 'Several patients share this name and birth date']
    );
  });

  it('searches by no last name, and asks for one, when the last name is missing or has no letters', async () => {
    const { store, calls } = memoryPatients([]);
    const match = nodeFor(store, 'match-patient');
    const unnamed = await run(match, { demographics: { ...demographics, lastName: '1-2' } });
    const missing = await run(match, { demographics: { ...demographics, lastName: null } });
    assert.deepEqual([unnamed.pin, missing.pin], ['incomplete', 'incomplete']);
    const search = { birthDate: '1980-01-02', lastNameKey: null, firstName: 'Jane' };
    assert.deepEqual(calls, [
      ['findCandidates', 'run', search],
      ['findCandidates', 'run', search]
    ]);
  });

  it('creates patients idempotently per step and loads chosen ones', async () => {
    const { store, calls } = memoryPatients([jane]);
    const create = nodeFor(store, 'create-patient');
    const find = nodeFor(store, 'find-patient');
    const created = await run(create, { demographics });
    assert.deepEqual(
      [created.pin, created.outputs.patient],
      ['created', { id: 'new', ...cleaned }]
    );
    assert.deepEqual(calls.at(-1), ['createPatient', 'run', 'key', false]);
    await run(create, { demographics, reuseMatch: true });
    assert.deepEqual(calls.at(-1), ['createPatient', 'run', 'key', true]);
    const invalid = await run(create, {
      demographics: { ...demographics, birthDate: '1980-02-31' }
    });
    assert.deepEqual([invalid.pin, invalid.outputs.patient], ['invalid', null]);
    const found = await run(find, { patientId: 'p1' });
    assert.deepEqual([found.pin, found.outputs], ['found', { patient: jane }]);
    assert.equal((await run(find, { patientId: 'p9' })).pin, 'missing');
    assert.equal((await run(find, { patientId: ' ' })).pin, 'missing');
    assert.equal((await run(find, {})).pin, 'missing');
  });

  it('moves a known patient to the complete address of a newer report', async () => {
    const { store, calls } = memoryPatients([jane]);
    const update = nodeFor(store, 'update-patient-address');
    const moved = {
      ...demographics,
      addressLine: '2 Elm St',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62701'
    };
    const updated = await run(update, { patient: jane, demographics: moved });
    const address = {
      addressLine: '2 Elm St',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62701'
    };
    assert.deepEqual(updated.outputs.patient, { ...jane, ...address });
    assert.deepEqual(calls.at(-1), ['updateAddress', 'run', 'key', 'p1', address]);
    const partial = await run(update, { patient: jane, demographics: { ...moved, city: null } });
    assert.deepEqual(partial.outputs.patient, jane);
    const same = { ...jane, ...moved, addressLine: '2 ELM ST.' };
    assert.deepEqual(
      (await run(update, { patient: same, demographics: moved })).outputs.patient,
      same
    );
    assert.equal(calls.filter((c) => c[0] === 'updateAddress').length, 1);
  });

  it('needs the id of the patient to move', async () => {
    const update = nodeFor(memoryPatients([jane]).store, 'update-patient-address');
    await assert.rejects(
      run(update, { patient: { ...jane, id: ' ' }, demographics }),
      /The patient has no id/
    );
  });
});
