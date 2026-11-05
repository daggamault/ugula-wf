import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FieldSpec } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChangeList, changesOf, changeValueText, FieldWas } from './task-changes.tsx';

const fields: FieldSpec[] = [
  { name: 'memberId', type: 'string', label: 'Member ID' },
  { name: 'level', type: 'string', options: [{ value: 'ALS1', label: 'ALS Level 1' }] },
  { name: 'miles', type: 'number' },
  { name: 'note', type: 'string' }
];

describe('changesOf', () => {
  it('lists only the fields that differ from their current value', () => {
    const changes = changesOf(
      fields,
      { memberId: '1EG4', level: null, miles: 8, note: '' },
      { memberId: '1EG5', level: 'ALS1', miles: 8, note: null }
    );
    assert.deepEqual(
      changes.map((c) => [c.field.name, c.was, c.now]),
      [
        ['memberId', '1EG4', '1EG5'],
        ['level', null, 'ALS1']
      ]
    );
  });

  it('marks a changed field with its current value and a way back', () => {
    const html = renderToStaticMarkup(
      createElement(FieldWas, {
        field: fields[1] as FieldSpec,
        was: 'ALS1',
        onReset: () => undefined
      })
    );
    assert.ok(html.includes('Changed from <span class="font-medium">ALS Level 1</span>'));
    assert.ok(html.includes('Undo<span class="sr-only"> change to Level</span>'));
  });
});

describe('ChangeList', () => {
  it('shows each change as current → new with option labels', () => {
    assert.equal(changeValueText(fields[1] as FieldSpec, 'ALS1'), 'ALS Level 1');
    assert.equal(changeValueText(fields[2] as FieldSpec, true), 'Yes');
    const html = renderToStaticMarkup(
      createElement(ChangeList, {
        changes: changesOf(fields, { memberId: '1EG4' }, { memberId: '1EG5', level: 'ALS1' })
      })
    );
    assert.ok(html.includes('Your Changes') && html.includes('(2)'));
    assert.ok(html.includes('Current: </span>1EG4') && html.includes('New: </span>1EG5'));
    assert.ok(html.includes('ALS Level 1'));
  });
});
