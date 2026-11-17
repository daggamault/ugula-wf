import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FieldSpec } from '@ugula/graph';
import { createElement } from 'react';
import { render, screen, userEvent, within } from '../../shared/testing-dom.ts';
import { ChangeList, changesOf, changeValueText, FieldWas } from './task-changes.tsx';

const MEMBER: FieldSpec = { name: 'memberId', type: 'string', label: 'Member ID' };
const LEVEL: FieldSpec = {
  name: 'level',
  type: 'string',
  options: [{ value: 'ALS1', label: 'ALS Level 1' }]
};
const MILES: FieldSpec = { name: 'miles', type: 'number' };
const NOTE: FieldSpec = { name: 'note', type: 'string' };
const FIELDS = [MEMBER, LEVEL, MILES, NOTE];

const summary = (changes: ReturnType<typeof changesOf>) =>
  changes.map((c) => [c.field.name, c.was, c.now]);

describe('changesOf', () => {
  it('lists only the fields that differ from their current value', () => {
    assert.deepEqual(
      summary(
        changesOf(
          FIELDS,
          { memberId: '1EG4', level: null, miles: 8, note: '' },
          { memberId: '1EG5', level: 'ALS1', miles: 8, note: null }
        )
      ),
      [
        ['memberId', '1EG4', '1EG5'],
        ['level', null, 'ALS1']
      ]
    );
  });

  it('treats blank strings, empty lists, null and missing values as the same', () => {
    const tags: FieldSpec = { name: 'tags', type: { list: 'string' } };
    assert.deepEqual(
      changesOf([NOTE, tags, MILES], { note: '  ', tags: [] }, { note: null, tags: null }),
      []
    );
  });

  it('compares lists and records by value', () => {
    const tags: FieldSpec = { name: 'tags', type: { list: 'string' } };
    assert.deepEqual(changesOf([tags], { tags: ['a', 'b'] }, { tags: ['a', 'b'] }), []);
    assert.deepEqual(summary(changesOf([tags], { tags: ['a', 'b'] }, { tags: ['b', 'a'] })), [
      ['tags', ['a', 'b'], ['b', 'a']]
    ]);
  });

  it('counts every filled value as a change when there are no current values', () => {
    assert.deepEqual(summary(changesOf(FIELDS, null, { miles: 0, note: '' })), [
      ['miles', null, 0]
    ]);
  });
});

describe('changeValueText', () => {
  it('shows a dash for blank values', () => {
    assert.equal(changeValueText(NOTE, null), '—');
    assert.equal(changeValueText(NOTE, ' '), '—');
    assert.equal(changeValueText(NOTE, []), '—');
  });

  it('shows the option label of a string, else the string', () => {
    assert.equal(changeValueText(LEVEL, 'ALS1'), 'ALS Level 1');
    assert.equal(changeValueText(LEVEL, 'BLS'), 'BLS');
  });

  it('shows yes or no, grouped numbers and lists joined', () => {
    assert.equal(changeValueText(MILES, true), 'Yes');
    assert.equal(changeValueText(MILES, false), 'No');
    assert.equal(changeValueText(MILES, 1234.5), (1234.5).toLocaleString());
    assert.equal(changeValueText(LEVEL, ['ALS1', 'BLS']), 'ALS Level 1, BLS');
  });

  it('shows the name of a record, else its JSON', () => {
    assert.equal(changeValueText(NOTE, { id: 'p1', name: 'Blue Plan' }), 'Blue Plan');
    assert.equal(changeValueText(NOTE, { id: 'p1' }), '{"id":"p1"}');
  });
});

describe('ChangeList', () => {
  it('shows each change as current → new with option labels', () => {
    render(
      createElement(ChangeList, {
        changes: changesOf(FIELDS, { memberId: '1EG4' }, { memberId: '1EG5', level: 'ALS1' })
      })
    );
    const list = screen.getByRole('region', { name: 'Your changes' });
    assert.equal(within(list).getByRole('heading').textContent, 'Your Changes (2)');
    assert.deepEqual(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
      ['Member IDCurrent: 1EG4New: 1EG5', 'LevelCurrent: —New: ALS Level 1']
    );
  });

  it('strikes through only a current value that was filled', () => {
    render(
      createElement(ChangeList, {
        changes: changesOf(FIELDS, { memberId: '1EG4' }, { memberId: '1EG5', level: 'ALS1' })
      })
    );
    const struck = screen
      .getAllByText('Current:')
      .map((label) => label.parentElement?.classList.contains('line-through'));
    assert.deepEqual(struck, [true, false]);
  });

  it('explains the list before anything changes', () => {
    render(createElement(ChangeList, { changes: [] }));
    const list = screen.getByRole('region', { name: 'Your changes' });
    assert.equal(within(list).getByRole('heading').textContent, 'No Changes Yet');
    assert.ok(
      within(list).getByText(
        'Fields show the current values. Anything you change is listed here as current → new.'
      )
    );
    assert.ok(!within(list).queryByRole('list'));
  });
});

describe('FieldWas', () => {
  it('says what a changed field was and undoes the change', async () => {
    const resets: string[] = [];
    render(
      createElement(FieldWas, { field: LEVEL, was: 'ALS1', onReset: () => resets.push('level') })
    );
    assert.ok(screen.getByText('ALS Level 1'));
    assert.equal(screen.getByText(/^Changed from/).textContent, 'Changed from ALS Level 1');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Undo change to Level' }));
    assert.deepEqual(resets, ['level']);
  });
});
