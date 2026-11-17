import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../testing-dom.ts';
import { hidePopover, showPopover } from './popover.ts';

const popover = (open: boolean) => {
  const el = document.createElement('div');
  el.popover = 'auto';
  document.body.append(el);
  if (open) el.showPopover();
  const toggles: string[] = [];
  el.addEventListener('toggle', (e) => toggles.push((e as ToggleEvent).newState));
  return { el, toggles };
};

describe('showPopover', () => {
  it('opens a closed popover', () => {
    const { el, toggles } = popover(false);
    showPopover(el);
    assert.equal(el.matches(':popover-open'), true);
    assert.deepEqual(toggles, ['open']);
    el.remove();
  });

  it('leaves an open popover alone', (t) => {
    const { el } = popover(true);
    const show = t.mock.method(el, 'showPopover');
    showPopover(el);
    assert.equal(show.mock.callCount(), 0);
    assert.equal(el.matches(':popover-open'), true);
    el.remove();
  });

  it('ignores a missing element', () => {
    assert.doesNotThrow(() => showPopover(null));
  });
});

describe('hidePopover', () => {
  it('closes an open popover', () => {
    const { el, toggles } = popover(true);
    hidePopover(el);
    assert.equal(el.matches(':popover-open'), false);
    assert.deepEqual(toggles, ['closed']);
    el.remove();
  });

  it('leaves a closed popover alone', (t) => {
    const { el } = popover(false);
    const hide = t.mock.method(el, 'hidePopover');
    hidePopover(el);
    assert.equal(hide.mock.callCount(), 0);
    el.remove();
  });

  it('ignores a missing element', () => {
    assert.doesNotThrow(() => hidePopover(null));
  });
});
