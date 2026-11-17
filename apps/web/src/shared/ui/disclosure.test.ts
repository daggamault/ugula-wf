import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent } from '../testing-dom.ts';
import { Disclosure } from './disclosure.tsx';

const show = (isPanel?: boolean) => {
  const { container } = render(
    createElement(Disclosure, { title: 'Functions', isPanel, children: 'Body' })
  );
  const details = container.querySelector('details');
  assert.ok(details);
  return { details, summary: screen.getByText('Functions'), user: userEvent.setup() };
};

describe('Disclosure', () => {
  it('starts collapsed behind a summary titled by the title', () => {
    const { details, summary } = show();
    assert.equal(details.open, false);
    assert.equal(summary.tagName, 'SUMMARY');
    assert.equal(summary.textContent, 'Functions');
    assert.equal(summary.querySelector('svg')?.getAttribute('aria-hidden'), 'true');
  });

  it('expands and collapses from the summary', async () => {
    const { details, summary, user } = show();
    await user.click(summary);
    assert.equal(details.open, true);
    await user.click(summary);
    assert.equal(details.open, false);
  });

  it('stands as its own bordered panel with a section-sized title', () => {
    const { details, summary } = show(true);
    assert.equal(details.classList.contains('border'), true);
    assert.equal(summary.classList.contains('text-base'), true);
  });

  it('sits inline without a border by default', () => {
    const { details, summary } = show();
    assert.equal(details.classList.contains('border'), false);
    assert.equal(summary.classList.contains('text-sm'), true);
  });
});
