import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addEntry,
  entryOf,
  moveItem,
  payersErrorOf,
  removeEntry,
  toPayerInput
} from './claim-payers.tsx';

describe('moveItem', () => {
  it('reorders within bounds and leaves the list alone otherwise', () => {
    assert.deepEqual(moveItem(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
    assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
    assert.deepEqual(moveItem(['a', 'b'], 0, -1), ['a', 'b']);
    assert.deepEqual(moveItem(['a', 'b'], 1, 2), ['a', 'b']);
  });
});

const entry = (id: string, name: string) => ({
  id,
  name,
  relationship: '18' as const,
  insuredFirstName: null,
  insuredLastName: null
});

describe('addEntry and removeEntry', () => {
  it('adds a payer once by name and removes only the chosen row', () => {
    const list = [entry('1', 'Medicare'), entry('2', 'Medicare')];
    assert.deepEqual(addEntry(list, ' medicare ', '3'), list);
    assert.deepEqual(addEntry(list, '  ', '3'), list);
    assert.deepEqual(addEntry(list, ' Aetna ', '3').at(-1), entry('3', 'Aetna'));
    assert.deepEqual(removeEntry(list, '2'), [entry('1', 'Medicare')]);
  });
});

describe('payer relationships', () => {
  it('reads coverage relationships and drops insured names for self', () => {
    assert.deepEqual(
      entryOf({
        id: 'c',
        position: 0,
        payer: 'A',
        payer_id: null,
        payer_code: null,
        member_id: null,
        group_id: null,
        relationship: '18',
        insured_first_name: null,
        insured_last_name: null,
        eligibility: null,
        eligibility_note: null,
        eligibility_checked_at: null,
        stay_kind: null,
        stay_admitted_on: null,
        stay_discharged_on: null
      }),
      entry('c', 'A')
    );
    assert.deepEqual(
      toPayerInput({ ...entry('c', 'A'), insuredFirstName: 'Sam', insuredLastName: 'Doe' }),
      { name: 'A', relationship: '18', insuredFirstName: null, insuredLastName: null }
    );
    assert.deepEqual(
      toPayerInput({
        ...entry('c', 'A'),
        relationship: '01',
        insuredFirstName: ' Sam ',
        insuredLastName: ''
      }),
      { name: 'A', relationship: '01', insuredFirstName: 'Sam', insuredLastName: null }
    );
  });

  it('needs the insured name whenever the patient is not the insured', () => {
    assert.equal(payersErrorOf([entry('1', 'A')]), undefined);
    assert.match(
      payersErrorOf([
        { ...entry('1', 'Blue Plan'), relationship: '19', insuredFirstName: 'Sam' }
      ]) ?? '',
      /first and last name for Blue Plan/
    );
    assert.equal(
      payersErrorOf([
        { ...entry('1', 'A'), relationship: '01', insuredFirstName: 'Sam', insuredLastName: 'Doe' }
      ]),
      undefined
    );
  });
});
