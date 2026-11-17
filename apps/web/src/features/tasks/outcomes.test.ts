import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FieldSpec } from '@ugula/graph';
import { BanIcon, CircleCheckIcon, LinkIcon } from 'lucide-react';
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
  { name: 'diagnoses', type: { list: 'string' }, required: ['save', 'link'] },
  { name: 'note', type: 'string' }
];

const names = (fields: readonly FieldSpec[]) => fields.map((f) => f.name);

describe('outcomeLabel', () => {
  it('uses the label a known outcome is given', () => {
    assert.equal(outcomeLabel('useSelected'), 'Use Selected Patient');
    assert.equal(outcomeLabel('moveToPatient'), 'Move to Patient');
    assert.equal(outcomeLabel('refund'), 'Approve Refund');
  });

  it('title-cases known outcomes without a label', () => {
    assert.equal(outcomeLabel('writeOff'), 'Write Off');
    assert.equal(outcomeLabel('approve'), 'Approve');
  });

  it('title-cases unknown outcomes, including names inherited from Object', () => {
    assert.equal(outcomeLabel('somethingNew'), 'Something New');
    assert.equal(outcomeLabel('toString'), 'To String');
  });
});

describe('outcomeIcon', () => {
  it('uses the icon of a known outcome', () => {
    assert.equal(outcomeIcon('void'), BanIcon);
    assert.equal(outcomeIcon('link'), LinkIcon);
  });

  it('falls back to a check for unknown outcomes', () => {
    assert.equal(outcomeIcon('somethingNew'), CircleCheckIcon);
    assert.equal(outcomeIcon('constructor'), CircleCheckIcon);
  });
});

describe('isDestructive', () => {
  it('marks voiding and writing off as destructive', () => {
    assert.equal(isDestructive('void'), true);
    assert.equal(isDestructive('writeOff'), true);
    assert.equal(isDestructive('approve'), false);
  });

  it('marks cancel destructive only on a fault', () => {
    assert.equal(isDestructive('cancel'), false);
    assert.equal(isDestructive('cancel', 'task'), false);
    assert.equal(isDestructive('cancel', 'fault'), true);
    assert.equal(isDestructive('retry', 'fault'), false);
  });
});

describe('fieldLabel', () => {
  it('title-cases a given label', () => {
    assert.equal(fieldLabel({ name: 'payerId', label: 'Directory payer' }), 'Directory Payer');
  });

  it('derives a label from the field name when none is given', () => {
    assert.equal(fieldLabel({ name: 'memberId' }), 'Member ID');
    assert.equal(fieldLabel({ name: 'amountCents' }), 'Amount');
  });
});

describe('missingFor', () => {
  it('lists the required fields left blank, empty or whitespace', () => {
    assert.deepEqual(names(missingFor(FIELDS, { payerId: ' ', diagnoses: [] }, 'link')), [
      'payerId',
      'diagnoses'
    ]);
    assert.deepEqual(names(missingFor(FIELDS, { payerId: null }, 'link')), [
      'payerId',
      'diagnoses'
    ]);
  });

  it('only checks the fields the chosen outcome requires', () => {
    assert.deepEqual(names(missingFor(FIELDS, { diagnoses: [] }, 'save')), ['diagnoses']);
    assert.deepEqual(missingFor(FIELDS, {}, 'unlisted'), []);
  });

  it('accepts filled fields, including zero and false', () => {
    const fields: FieldSpec[] = [
      { name: 'amount', type: 'number', required: ['save'] },
      { name: 'ok', type: 'boolean', required: ['save'] }
    ];
    assert.deepEqual(missingFor(fields, { amount: 0, ok: false }, 'save'), []);
    assert.deepEqual(missingFor(FIELDS, { payerId: 'p1', diagnoses: ['R07.9'] }, 'link'), []);
  });
});

describe('missingReason', () => {
  it('names every missing field in order', () => {
    assert.equal(
      missingReason(missingFor(FIELDS, {}, 'link')),
      'Fill in Directory Payer, Diagnoses first.'
    );
  });

  it('gives no reason when nothing is missing', () => {
    assert.equal(missingReason([]), undefined);
  });
});

describe('outcomeHint', () => {
  it("prefers the workflow's hint", () => {
    assert.equal(outcomeHint({ hints: { void: 'Voids it here.' } }, 'void'), 'Voids it here.');
  });

  it('falls back to the meaning of outcomes that mean one thing everywhere', () => {
    assert.equal(
      outcomeHint({ hints: {} }, 'void'),
      'Closes the claim as void; it is never billed.'
    );
    assert.equal(outcomeHint({ hints: null }, 'selfPay'), 'Bills the patient; no payer is billed.');
    assert.equal(
      outcomeHint({}, 'keepCredit'),
      'Keeps the credit on the claim; no refund is sent.'
    );
  });

  it('has no hint for outcomes whose meaning depends on the workflow', () => {
    assert.equal(outcomeHint({ hints: {} }, 'continue'), null);
    assert.equal(outcomeHint({ hints: { void: 'x' } }, 'save'), null);
    assert.equal(outcomeHint({}, 'toString'), null);
  });
});

describe('consequenceOf', () => {
  it('says what an outcome does and that it is final', () => {
    assert.equal(
      consequenceOf({ hints: {} }, 'void'),
      'Closes the claim as void; it is never billed. This cannot be undone.'
    );
    assert.equal(
      consequenceOf({ hints: { cancel: 'Stops the run.' } }, 'cancel'),
      'Stops the run. This cannot be undone.'
    );
  });

  it('says the workflow continues when the outcome has no hint', () => {
    assert.equal(
      consequenceOf({}, 'toString'),
      'The workflow continues from this choice. This cannot be undone.'
    );
  });
});

describe('fieldsByOutcome', () => {
  const classification: FieldSpec = { name: 'classification', type: 'string', required: ['claim'] };
  const note: FieldSpec = { name: 'note', type: 'string' };
  const reason: FieldSpec = { name: 'reason', type: 'string', required: ['hold', 'void'] };
  const other: FieldSpec = { name: 'other', type: 'string', required: ['hold'] };

  it('puts a field only one offered outcome needs with that outcome', () => {
    const { shared, own } = fieldsByOutcome([classification, note, reason], ['claim', 'skip']);
    assert.deepEqual(shared, [note, reason]);
    assert.deepEqual(own('claim'), [classification]);
    assert.deepEqual(own('skip'), []);
  });

  it('shares a field required by an outcome that is not offered', () => {
    const { shared, own } = fieldsByOutcome([other], ['claim', 'skip']);
    assert.deepEqual(shared, [other]);
    assert.deepEqual(own('hold'), []);
  });

  it('keeps every field shared when there is one outcome', () => {
    const amount: FieldSpec = { name: 'amount', type: 'number', required: ['save'] };
    const { shared, own } = fieldsByOutcome([amount], ['save']);
    assert.deepEqual(shared, [amount]);
    assert.deepEqual(own('save'), []);
  });
});
