import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen } from './testing-dom.ts';

const popover = () => {
  const el = document.createElement('div');
  el.setAttribute('popover', '');
  document.body.append(el);
  const toggles: string[] = [];
  el.addEventListener('toggle', (e) => {
    const { oldState, newState } = e as Event & { oldState: string; newState: string };
    toggles.push(`${oldState}->${newState}`);
  });
  return { el, toggles };
};

describe('popover', () => {
  it('opens and closes, matching :popover-open and firing toggle once per change', () => {
    const { el, toggles } = popover();
    assert.equal(el.matches(':popover-open'), false);
    el.showPopover();
    el.showPopover();
    assert.equal(el.matches(':popover-open'), true);
    el.hidePopover();
    el.hidePopover();
    assert.equal(el.matches(':popover-open'), false);
    assert.deepEqual(toggles, ['closed->open', 'open->closed']);
    el.remove();
  });

  it('toggles, or forces a state, and returns the state it ends in', () => {
    const { el, toggles } = popover();
    assert.equal(el.togglePopover(), true);
    assert.equal(el.togglePopover(true), true);
    assert.equal(el.togglePopover(), false);
    assert.equal(el.togglePopover(false), false);
    assert.deepEqual(toggles, ['closed->open', 'open->closed']);
    el.remove();
  });
});

describe(':disabled', () => {
  it('disables the controls of a disabled fieldset except those in its first legend', () => {
    render(
      createElement(
        'fieldset',
        { disabled: true },
        createElement('legend', null, createElement('button', { type: 'button' }, 'In Legend')),
        createElement('button', { type: 'button' }, 'Inside'),
        createElement('fieldset', null, createElement('input', { 'aria-label': 'Nested' }))
      )
    );
    assert.equal(screen.getByRole('button', { name: 'In Legend' }).matches(':disabled'), false);
    assert.equal(screen.getByRole('button', { name: 'Inside' }).matches(':disabled'), true);
    assert.equal(screen.getByRole('textbox', { name: 'Nested' }).matches(':disabled'), true);
  });

  it('leaves other elements and selectors to the DOM', () => {
    render(
      createElement(
        'fieldset',
        { disabled: true },
        createElement('p', null, 'Note'),
        createElement('button', { type: 'button', className: 'go' }, 'Go')
      )
    );
    assert.equal(screen.getByText('Note').matches(':disabled'), false);
    assert.equal(screen.getByRole('button', { name: 'Go' }).matches('.go'), true);
  });
});

describe('stepMismatch', () => {
  const amount = (step: string, value: string) => {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = step;
    input.value = value;
    return input.validity.stepMismatch;
  };

  it('accepts whole steps despite floating point error', () => {
    assert.equal(amount('0.01', '950.07'), false);
    assert.equal(amount('0.01', '0.29'), false);
  });

  it('rejects values between steps', () => {
    assert.equal(amount('0.01', '950.075'), true);
    assert.equal(amount('1', '2.5'), true);
  });

  it('accepts anything when the step is any', () => {
    assert.equal(amount('any', '0.123456'), false);
  });
});

describe('cleanup', () => {
  it('starts each test on an empty page at the root address', () => {
    assert.equal(document.body.innerHTML, '');
    assert.equal(window.location.pathname, '/');
    window.history.replaceState(null, '', '/claims');
    render(createElement('p', null, 'Left Behind'));
  });

  it('removed what the previous test rendered and reset its address', () => {
    assert.ok(!screen.queryByText('Left Behind'));
    assert.equal(window.location.pathname, '/');
  });
});
