import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent } from '../testing-dom.ts';
import { DisabledReason, preventDisabledClick } from './disabled-reason.tsx';

describe('DisabledReason', () => {
  it('describes a blocked control by the reason', () => {
    render(
      createElement(
        'div',
        null,
        createElement('button', { type: 'button', 'aria-describedby': 'r' }, 'Save'),
        createElement(DisabledReason, { id: 'r', reason: 'Busy' })
      )
    );
    screen.getByRole('button', { name: 'Save', description: 'Busy' });
    assert.equal(screen.getByText('Busy').className, 'sr-only');
  });

  it('renders nothing without a reason', () => {
    const { container } = render(createElement(DisabledReason, { id: 'r', reason: undefined }));
    assert.equal(container.innerHTML, '');
  });
});

describe('preventDisabledClick', () => {
  it('cancels the default action, so a blocked submit does not submit', async () => {
    const submits: string[] = [];
    render(
      createElement(
        'form',
        {
          onSubmit: (e: { preventDefault: () => void }) => {
            e.preventDefault();
            submits.push('submit');
          }
        },
        createElement('button', { type: 'submit', onClick: preventDisabledClick }, 'Save')
      )
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }));
    assert.deepEqual(submits, []);
  });
});
