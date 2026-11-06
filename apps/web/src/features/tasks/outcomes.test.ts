import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FieldSpec } from '@ugula/graph';
import { BanIcon, CircleCheckIcon } from 'lucide-react';
import {
  consequenceOf,
  fieldLabel,
  fieldsByOutcome,
  isDestructive,
  missingFor,
  missingReason,
  outcomeHint,
  outcomeIcon,
  outcomeLabel
} from './outcomes.ts';

const FIELDS: FieldSpec[] = [
  { name: 'payerId', type: 'string', label: 'Directory payer', required: ['link'] },
  { name: 'diagnoses', type: { list: 'string' }, required: ['save'] },
  { name: 'note', type: 'string' }
];

describe('outcomes', () => {
  it('labels outcomes, falling back to title case', () => {
    assert.equal(outcomeLabel('useSelected'), 'Use Selected Patient');
    assert.equal(outcomeLabel('writeOff'), 'Write Off');
    assert.equal(outcomeLabel('moveToPatient'), 'Move to Patient');
    assert.equal(outcomeLabel('refund'), 'Approve Refund');
    assert.equal(outcomeLabel('somethingNew'), 'Something New');
    assert.equal(outcomeLabel('toString'), 'To String');
    assert.equal(outcomeIcon('constructor'), CircleCheckIcon);
  });

  it('gives every outcome an icon and marks destructive ones', () => {
    assert.equal(outcomeIcon('void'), BanIcon);
    assert.equal(outcomeIcon('somethingNew'), CircleCheckIcon);
    assert.equal(isDestructive('void'), true);
    assert.equal(isDestructive('writeOff'), true);
    assert.equal(isDestructive('approve'), false);
    assert.equal(isDestructive('cancel'), false);
    assert.equal(isDestructive('cancel', 'fault'), true);
  });

  it('labels fields in title case', () => {
    assert.equal(fieldLabel({ name: 'payerId', label: 'Directory payer' }), 'Directory Payer');
    assert.equal(fieldLabel({ name: 'memberId' }), 'Member ID');
  });

  it('lists the empty fields an outcome requires', () => {
    assert.deepEqual(
      missingFor(FIELDS, { payerId: ' ', diagnoses: [] }, 'link').map((f) => f.name),
      ['payerId']
    );
    assert.deepEqual(
      missingFor(FIELDS, { diagnoses: [] }, 'save').map((f) => f.name),
      ['diagnoses']
    );
    assert.deepEqual(missingFor(FIELDS, { payerId: 'p1' }, 'link'), []);
    assert.deepEqual(missingFor(FIELDS, {}, 'unlisted'), []);
    assert.equal(missingReason(missingFor(FIELDS, {}, 'link')), 'Fill in Directory Payer first.');
    assert.equal(missingReason([]), undefined);
  });
});

describe('outcomeHint', () => {
  it("prefers the workflow's hint, falls back only for outcomes that mean one thing", () => {
    assert.equal(outcomeHint({ hints: { void: 'Voids it here.' } }, 'void'), 'Voids it here.');
    assert.equal(
      outcomeHint({ hints: {} }, 'void'),
      'Closes the claim as void; it is never billed.'
    );
    assert.equal(outcomeHint({ hints: {} }, 'continue'), null);
    assert.equal(outcomeHint({ hints: {} }, 'save'), null);
    assert.equal(outcomeHint({}, 'toString'), null);
  });
});

describe('consequenceOf', () => {
  it('says what a destructive outcome does before it is confirmed', () => {
    assert.equal(
      consequenceOf({ hints: {} }, 'void'),
      'Closes the claim as void; it is never billed. This cannot be undone.'
    );
    assert.equal(
      consequenceOf({ hints: { cancel: 'Stops the run.' } }, 'cancel'),
      'Stops the run. This cannot be undone.'
    );
    assert.equal(
      consequenceOf({}, 'toString'),
      'The workflow continues from this choice. This cannot be undone.'
    );
  });
});

describe('fieldsByOutcome', () => {
  it('puts a field only one outcome needs with that outcome', () => {
    const classification: FieldSpec = {
      name: 'classification',
      type: 'string',
      required: ['claim']
    };
    const note: FieldSpec = { name: 'note', type: 'string' };
    const reason: FieldSpec = { name: 'reason', type: 'string', required: ['hold', 'void'] };
    const { shared, own } = fieldsByOutcome([classification, note, reason], ['claim', 'skip']);
    assert.deepEqual(shared, [note, reason]);
    assert.deepEqual(own('claim'), [classification]);
    assert.deepEqual(own('skip'), []);
  });

  it('keeps every field shared when there is one outcome', () => {
    const amount: FieldSpec = { name: 'amount', type: 'number', required: ['save'] };
    assert.deepEqual(fieldsByOutcome([amount], ['save']).shared, [amount]);
  });
});
