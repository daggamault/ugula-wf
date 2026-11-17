import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, within } from '../testing-dom.ts';
import { Detail, DetailList } from './detail-list.tsx';

const show = () =>
  render(
    createElement(
      DetailList,
      null,
      createElement(Detail, { label: 'Total', isEmphasized: true, children: '$10.00' }),
      createElement(Detail, { label: 'Born', children: '1958-04-12' })
    )
  );

describe('DetailList', () => {
  it('pairs each term with its value in order', () => {
    const { container } = show();
    const list = container.querySelector('dl');
    assert.ok(list);
    assert.deepEqual(
      within(list)
        .getAllByRole('term')
        .map((t) => t.textContent),
      ['Total', 'Born']
    );
    assert.deepEqual(
      within(list)
        .getAllByRole('definition')
        .map((d) => d.textContent),
      ['$10.00', '1958-04-12']
    );
  });

  it('enlarges emphasized values only', () => {
    show();
    assert.equal(screen.getByText('$10.00').classList.contains('text-xl'), true);
    assert.equal(screen.getByText('1958-04-12').classList.contains('text-xl'), false);
    assert.equal(screen.getByText('1958-04-12').classList.contains('text-sm'), true);
  });
});
