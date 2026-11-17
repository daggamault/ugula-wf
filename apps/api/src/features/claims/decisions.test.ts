import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decisionOf, decisionValues, withDecision } from './decisions.ts';

const FIELDS = [
  {
    name: 'classification',
    type: 'string',
    label: 'Classification',
    options: [{ value: 'emergency', label: 'Emergency Transport' }]
  },
  { name: 'loadedMiles', type: 'number' },
  { name: 'abnOnFile', type: 'boolean', label: 'ABN on file' },
  { name: 'payers', type: { list: 'string' } }
];

describe('decisionValues', () => {
  it('shows what the biller set, with option labels, skipping what they left as it was', () => {
    assert.deepEqual(
      decisionValues(
        FIELDS,
        { classification: 'emergency', loadedMiles: 12.4, abnOnFile: true, payers: ['Medicare'] },
        { loadedMiles: 12.4 }
      ),
      [
        { label: 'Classification', value: 'Emergency Transport' },
        { label: 'ABN on file', value: 'Yes' }
      ]
    );
  });

  it('labels unlabeled fields from their name and keeps unknown options as given', () => {
    assert.deepEqual(decisionValues(FIELDS, { loadedMiles: 3, classification: 'other' }, null), [
      { label: 'Classification', value: 'other' },
      { label: 'Loaded miles', value: '3' }
    ]);
  });

  it('shows nothing for blank values or a task without fields', () => {
    assert.deepEqual(decisionValues(FIELDS, { classification: ' ' }, null), []);
    assert.deepEqual(decisionValues(null, { classification: 'emergency' }, null), []);
  });
});

describe('decisionOf', () => {
  const row = {
    task_title: 'Review classification',
    task_outcome: 'skipClaim',
    task_fields: FIELDS,
    task_defaults: null,
    task_values: {}
  };

  it('names the task and the outcome chosen', () => {
    assert.deepEqual(decisionOf(row), {
      task: 'Review classification',
      outcome: 'skipClaim',
      values: []
    });
  });

  it('has no decision for an event no task made', () => {
    assert.equal(decisionOf({ ...row, task_title: null }), null);
  });

  it('replaces the task columns with the decision', () => {
    assert.deepEqual(withDecision({ id: 'e1', ...row }), {
      id: 'e1',
      decision: { task: 'Review classification', outcome: 'skipClaim', values: [] }
    });
  });
});
