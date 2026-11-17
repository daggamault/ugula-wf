import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement, useState } from 'react';
import { render, screen, userEvent, within } from '../testing-dom.ts';
import { ListRows, moved } from './list-rows.tsx';

type Row = { code: string };

const showRows = ({
  editable = true,
  items = [{ code: 'a' }, { code: 'b' }, { code: 'c' }] as Row[],
  nameOf
}: {
  editable?: boolean;
  items?: Row[];
  nameOf?: (item: Row, index: number) => string;
} = {}) => {
  const changes: Row[][] = [];
  const Host = () => {
    const [rows, setRows] = useState(items);
    return createElement(ListRows<Row>, {
      id: 'rows',
      noun: 'Case',
      items: rows,
      editable,
      blank: () => ({ code: '' }),
      nameOf,
      onChange: (next: Row[]) => {
        changes.push(next);
        setRows(next);
      },
      children: (item: Row, i: number, set: (next: Row) => void) =>
        createElement('input', {
          'aria-label': `Code ${i + 1}`,
          value: item.code,
          onChange: (e: { target: { value: string } }) => set({ code: e.target.value })
        })
    });
  };
  render(createElement(Host));
  const codes = () =>
    screen.queryAllByRole<HTMLInputElement>('textbox').map((input) => input.value);
  return { changes, codes, user: userEvent.setup() };
};

describe('ListRows', () => {
  it('lists each row in order', () => {
    const { codes } = showRows();
    const list = screen.getByRole('list');
    assert.equal(list.tagName, 'OL');
    assert.equal(within(list).getAllByRole('listitem').length, 3);
    assert.deepEqual(codes(), ['a', 'b', 'c']);
  });

  it('shows no list when there are no rows', () => {
    showRows({ items: [] });
    assert.ok(!screen.queryByRole('list'));
    screen.getByRole('button', { name: 'Add Case' });
  });

  it('names row actions by the noun and position by default', () => {
    showRows();
    screen.getByRole('button', { name: 'Move Case 2 up' });
    screen.getByRole('button', { name: 'Move Case 2 down' });
    screen.getByRole('button', { name: 'Remove Case 2' });
  });

  it('names row actions with a custom name', () => {
    showRows({ nameOf: (item) => item.code.toUpperCase() });
    screen.getByRole('button', { name: 'Move B up' });
    screen.getByRole('button', { name: 'Remove C' });
  });

  it('blocks moving the first row up and the last row down', () => {
    showRows();
    const up = screen.getByRole('button', { name: 'Move Case 1 up' });
    const down = screen.getByRole('button', { name: 'Move Case 3 down' });
    assert.equal(up.getAttribute('aria-disabled'), 'true');
    assert.equal(down.getAttribute('aria-disabled'), 'true');
    assert.equal(
      screen.getByRole('button', { name: 'Move Case 1 down' }).getAttribute('aria-disabled'),
      null
    );
  });

  it('edits a row in place', async () => {
    const { changes, codes, user } = showRows();
    await user.type(screen.getByRole('textbox', { name: 'Code 2' }), 'x');
    assert.deepEqual(changes, [[{ code: 'a' }, { code: 'bx' }, { code: 'c' }]]);
    assert.deepEqual(codes(), ['a', 'bx', 'c']);
  });

  it('moves a row up and down', async () => {
    const { codes, user } = showRows();
    await user.click(screen.getByRole('button', { name: 'Move Case 2 up' }));
    assert.deepEqual(codes(), ['b', 'a', 'c']);
    await user.click(screen.getByRole('button', { name: 'Move Case 2 down' }));
    assert.deepEqual(codes(), ['b', 'c', 'a']);
  });

  it('ignores a blocked move', async () => {
    const { changes, user } = showRows();
    await user.click(screen.getByRole('button', { name: 'Move Case 1 up' }));
    assert.deepEqual(changes, []);
  });

  it('removes a row', async () => {
    const { codes, user } = showRows();
    await user.click(screen.getByRole('button', { name: 'Remove Case 2' }));
    assert.deepEqual(codes(), ['a', 'c']);
  });

  it('adds a blank row at the end', async () => {
    const { changes, codes, user } = showRows();
    await user.click(screen.getByRole('button', { name: 'Add Case' }));
    assert.deepEqual(changes, [[{ code: 'a' }, { code: 'b' }, { code: 'c' }, { code: '' }]]);
    assert.deepEqual(codes(), ['a', 'b', 'c', '']);
  });

  it('shows only the rows when read-only', () => {
    const { codes } = showRows({ editable: false });
    assert.deepEqual(codes(), ['a', 'b', 'c']);
    assert.equal(screen.queryAllByRole('button').length, 0);
  });

  it('shows nothing when read-only with no rows', () => {
    showRows({ editable: false, items: [] });
    assert.ok(!screen.queryByRole('list'));
    assert.equal(screen.queryAllByRole('button').length, 0);
  });
});

describe('moved', () => {
  it('moves an item up', () => {
    assert.deepEqual(moved(['a', 'b', 'c'], 1, -1), ['b', 'a', 'c']);
  });

  it('moves an item down', () => {
    assert.deepEqual(moved(['a', 'b', 'c'], 1, 1), ['a', 'c', 'b']);
  });

  it('returns an unchanged copy when the item cannot move', () => {
    const items = ['a', 'b'];
    const up = moved(items, 0, -1);
    assert.deepEqual(up, ['a', 'b']);
    assert.ok(up !== items);
    assert.deepEqual(moved(items, 1, 1), ['a', 'b']);
  });

  it('returns an unchanged copy for an index outside the list', () => {
    assert.deepEqual(moved(['a', 'b'], 5, -1), ['a', 'b']);
  });
});
