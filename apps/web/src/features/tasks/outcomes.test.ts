import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FieldSpec } from '@ugula/graph';
import { BanIcon, CircleCheckIcon } from 'lucide-react';
import {
  consequenceOf,
  fieldLabel,
  isDestructive,
  missingFor,
  missingReason,
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

describe('consequenceOf', () => {
  it('says what a destructive outcome does before it is confirmed', () => {
    assert.equal(
      consequenceOf('void'),
      'The claim closes as void and is never billed. This cannot be undone.'
    );
    assert.equal(
      consequenceOf('toString'),
      'The workflow continues from this choice. This cannot be undone.'
    );
  });
});
