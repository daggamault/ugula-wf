import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hidePopover, showPopover } from './popover.ts';

const popover = (open: boolean) => {
  const calls: string[] = [];
  const el = {
    matches: () => open,
    showPopover: () => calls.push('show'),
    hidePopover: () => calls.push('hide')
  } as unknown as HTMLElement;
  return { el, calls };
};

describe('popover', () => {
  it('only shows a closed popover and only hides an open one', () => {
    const closed = popover(false);
    showPopover(closed.el);
    hidePopover(closed.el);
    assert.deepEqual(closed.calls, ['show']);

    const open = popover(true);
    showPopover(open.el);
    hidePopover(open.el);
    assert.deepEqual(open.calls, ['hide']);
  });

  it('ignores a missing element', () => {
    assert.doesNotThrow(() => {
      showPopover(null);
      hidePopover(null);
    });
  });
});
