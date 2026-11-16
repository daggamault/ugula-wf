import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { valueKinds } from '@ugula/catalog';
import type { Json } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createCatalog } from '../../shared/graph/catalog.ts';
import { ValueKindsContext } from '../../shared/graph/pins.ts';
import { testNodes } from '../../shared/testing.ts';
import {
  FieldsEditor,
  fieldsOf,
  outcomesOf,
  RecordFieldsEditor,
  TaskEditor,
  withOutcomes
} from './task-editor.tsx';

const task = {
  title: 'Match Payer',
  queue: 'billing',
  instructions: 'Pick the payer.',
  permission: 'claims:update',
  outcomes: ['matched', 'skip'],
  hints: { matched: 'Uses the payer you chose.' },
  fields: [
    { name: 'payer', type: 'string', required: ['matched'], options: ['A', 'B'] },
    { name: 'note', type: 'string' }
  ]
};

const render = (component: typeof TaskEditor, config: Json, editable = true) =>
  renderToStaticMarkup(
    createElement(
      ValueKindsContext.Provider,
      { value: valueKinds },
      createElement(component, {
        nodeId: 't',
        config,
        editable,
        onConfig: () => undefined,
        def: {
          signature: { execIn: [], execOut: [], inputs: [], outputs: [] },
          variables: [],
          nodes: [],
          edges: []
        },
        catalog: createCatalog(testNodes)
      })
    )
  );

describe('TaskEditor', () => {
  it('builds the task form without JSON', () => {
    const html = render(TaskEditor, task);
    assert.ok(html.includes('value="Match Payer"') && html.includes('value="billing"'));
    assert.ok(html.includes('Pick the payer.</textarea>'));
    assert.ok(
      html.includes('Change claims, restart their cycle and check eligibility (claims:update)')
    );
    assert.ok(html.includes('>Defaults Are</label>') && html.includes('>Starting Values</span>'));
    assert.ok(
      html.includes('value="matched"') && html.includes('value="Uses the payer you chose."')
    );
    assert.ok(html.includes('Add Outcome') && html.includes('Add Field'));
    assert.ok(html.includes('id="t-fields-0-required"') && html.includes('>matched</span>'));
    assert.ok(html.includes('id="t-fields-0-options-0-value"') && html.includes('Add Choice'));
    assert.ok(!html.includes('<textarea class="min-h-24 resize-y py-2 font-mono'));
    const locked = render(TaskEditor, task, false);
    assert.ok(locked.includes('<fieldset disabled=""') && !locked.includes('Add Field'));
  });

  it('keeps hints and required fields in step with renamed, moved and removed outcomes', () => {
    const outcomes = outcomesOf(task);
    assert.deepEqual(outcomes, [
      { name: 'matched', hint: 'Uses the payer you chose.' },
      { name: 'skip', hint: '' }
    ]);
    const renamed = withOutcomes(
      task,
      [{ ...outcomes[0], name: 'found', hint: 'Found.' }, outcomes[1]].filter(
        (o) => o !== undefined
      )
    );
    assert.deepEqual(renamed.outcomes, ['found', 'skip']);
    assert.deepEqual(renamed.hints, { found: 'Found.' });
    assert.deepEqual(fieldsOf(renamed.fields)[0]?.required, ['found']);
    const moved = withOutcomes(task, [...outcomes].reverse());
    assert.deepEqual(fieldsOf(moved.fields)[0]?.required, ['matched']);
    const removed = withOutcomes(task, outcomes.slice(1));
    assert.equal(fieldsOf(removed.fields)[0]?.required, undefined);
    assert.equal(removed.hints, undefined);
  });
});

describe('FieldsEditor', () => {
  it('edits record fields with a type picker, and task-only parts only for tasks', () => {
    const html = renderToStaticMarkup(
      createElement(FieldsEditor, {
        id: 'f',
        fields: [{ name: 'claimId', type: { id: 'claim' }, label: 'Claim' }],
        editable: true,
        onChange: () => undefined
      })
    );
    assert.ok(html.includes('value="claimId"') && html.includes('value="Claim"'));
    assert.ok(html.includes('id="f-0-type"') && !html.includes('Required To'));
    const record = render(RecordFieldsEditor, { fields: [{ name: 'a', type: 'number' }] });
    assert.ok(record.includes('value="a"') && record.includes('>Number</span>'));
  });
});
