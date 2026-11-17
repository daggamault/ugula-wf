import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement, useState } from 'react';
import { render, screen, userEvent } from '../testing-dom.ts';
import { Checkbox } from './checkbox.tsx';

describe('Checkbox', () => {
  it('renders a named checkbox reflecting its checked state', () => {
    render(createElement(Checkbox, { 'aria-label': 'View Claims', checked: true, readOnly: true }));
    const box = screen.getByRole('checkbox', { name: 'View Claims', checked: true });
    assert.equal(box.getAttribute('type'), 'checkbox');
  });

  it('reports toggles through onChange', async () => {
    const changes: boolean[] = [];
    const Host = () => {
      const [checked, setChecked] = useState(false);
      return createElement(Checkbox, {
        'aria-label': 'View Claims',
        checked,
        onChange: (e) => {
          changes.push(e.target.checked);
          setChecked(e.target.checked);
        }
      });
    };
    render(createElement(Host));
    const user = userEvent.setup();
    const box = screen.getByRole('checkbox', { name: 'View Claims' });
    await user.click(box);
    await user.keyboard(' ');
    assert.deepEqual(changes, [true, false]);
    assert.equal((box as HTMLInputElement).checked, false);
  });

  it('cannot be toggled when disabled', async () => {
    const changes: boolean[] = [];
    render(
      createElement(Checkbox, {
        'aria-label': 'View Claims',
        disabled: true,
        onChange: (e) => changes.push(e.target.checked)
      })
    );
    const box = screen.getByRole('checkbox', { name: 'View Claims' });
    assert.equal((box as HTMLInputElement).disabled, true);
    await userEvent.setup().click(box);
    assert.deepEqual(changes, []);
  });
});
