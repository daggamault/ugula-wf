import assert from 'node:assert/strict';
import { beforeEach, describe, it, type TestContext } from 'node:test';
import { createElement } from 'react';
import { act, render, screen } from '../testing-dom.ts';
import { Tooltip, type TooltipSide } from './tooltip.tsx';

let now = 0;

beforeEach((t) => {
  now += 10_000;
  (t as TestContext).mock.method(performance, 'now', () => now);
});

const showTooltip = (t: TestContext, { side = 'top' as TooltipSide, disabled = false } = {}) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  render(
    createElement(
      'div',
      null,
      createElement(Tooltip, {
        label: 'Sign Out',
        side,
        children: createElement(
          'button',
          { type: 'button', 'aria-disabled': disabled || undefined },
          createElement('span', null, 'Out')
        )
      }),
      createElement('button', { type: 'button' }, 'Elsewhere')
    )
  );
  const button = screen.getByRole('button', { name: 'Out' });
  const tip = screen.getByText('Sign Out');
  const pointer = (type: string, pointerType = 'mouse', target: Element = button) =>
    act(() => {
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType }));
    });
  const tick = (ms: number) => act(() => t.mock.timers.tick(ms));
  const isShown = () => tip.matches(':popover-open');
  return { button, tip, pointer, tick, isShown };
};

describe('Tooltip', () => {
  it('wraps its trigger with a label hidden from assistive tech in a manual popover', (t) => {
    const { button, tip, isShown } = showTooltip(t);
    assert.ok(button.parentElement === tip.parentElement);
    assert.equal(tip.getAttribute('aria-hidden'), 'true');
    assert.equal(tip.getAttribute('popover'), 'manual');
    assert.equal(isShown(), false);
  });

  it('anchors the label to its trigger', (t) => {
    const { tip } = showTooltip(t);
    const anchor = tip.parentElement?.getAttribute('style') ?? '';
    const name = anchor.match(/anchor-name:\s*(--anchor-[\w-]+)/)?.[1];
    assert.ok(name);
    assert.match(tip.getAttribute('style') ?? '', new RegExp(`position-anchor:\\s*${name}`));
  });

  it('places the label on the chosen side', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const sides = (['top', 'right', 'bottom', 'left'] as const).map((side) => {
      const { unmount } = render(
        createElement(Tooltip, {
          label: side,
          side,
          children: createElement('button', { type: 'button' })
        })
      );
      const classes = [...screen.getByText(side).classList].filter((c) =>
        c.startsWith('[position-area:')
      );
      unmount();
      return classes;
    });
    assert.deepEqual(sides, [
      ['[position-area:top]'],
      ['[position-area:right]'],
      ['[position-area:bottom]'],
      ['[position-area:left]']
    ]);
  });

  it('shows after a short hover delay', (t) => {
    const { pointer, tick, isShown } = showTooltip(t);
    pointer('pointerenter');
    tick(299);
    assert.equal(isShown(), false);
    tick(1);
    assert.equal(isShown(), true);
  });

  it('hides when the pointer leaves', (t) => {
    const { pointer, tick, isShown } = showTooltip(t);
    pointer('pointerenter');
    tick(300);
    pointer('pointerleave');
    assert.equal(isShown(), false);
  });

  it('never shows when the pointer leaves before the delay', (t) => {
    const { pointer, tick, isShown } = showTooltip(t);
    pointer('pointerenter');
    tick(100);
    pointer('pointerleave');
    tick(1_000);
    assert.equal(isShown(), false);
  });

  it('shows at once when moving between tooltips quickly, and after the delay once cold', (t) => {
    const { pointer, tick, isShown } = showTooltip(t);
    pointer('pointerenter');
    tick(300);
    pointer('pointerleave');
    now += 299;
    pointer('pointerenter');
    tick(0);
    assert.equal(isShown(), true);
    pointer('pointerleave');
    now += 300;
    pointer('pointerenter');
    tick(0);
    assert.equal(isShown(), false);
    tick(300);
    assert.equal(isShown(), true);
  });

  it('ignores touch hovering', (t) => {
    const { pointer, tick, isShown } = showTooltip(t);
    pointer('pointerenter', 'touch');
    tick(1_000);
    assert.equal(isShown(), false);
  });

  it('hides on press', (t) => {
    const { pointer, tick, isShown } = showTooltip(t);
    pointer('pointerenter');
    tick(300);
    pointer('pointerdown');
    assert.equal(isShown(), false);
  });

  it('does not show when an enabled control is tapped', (t) => {
    const { pointer, tick, isShown } = showTooltip(t);
    pointer('pointerdown', 'touch');
    tick(0);
    assert.equal(isShown(), false);
  });

  it('explains a blocked control when tapped, then hides after a while', (t) => {
    const { pointer, tick, isShown, button } = showTooltip(t, { disabled: true });
    pointer('pointerdown', 'touch', button.querySelector('span') ?? button);
    assert.equal(isShown(), true);
    tick(2_499);
    assert.equal(isShown(), true);
    tick(1);
    assert.equal(isShown(), false);
  });

  it('shows at once on keyboard focus and hides on blur', (t) => {
    const { button, isShown, tick } = showTooltip(t);
    act(() => button.focus());
    tick(0);
    assert.equal(isShown(), true);
    act(() => button.blur());
    assert.equal(isShown(), false);
  });

  it('hides on Escape', (t) => {
    const { pointer, tick, isShown } = showTooltip(t);
    pointer('pointerenter');
    tick(300);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    assert.equal(isShown(), false);
  });

  it('stays open on other keys', (t) => {
    const { pointer, tick, isShown } = showTooltip(t);
    pointer('pointerenter');
    tick(300);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    });
    assert.equal(isShown(), true);
  });

  it('hides when the user presses elsewhere', (t) => {
    const { pointer, tick, isShown } = showTooltip(t);
    pointer('pointerenter');
    tick(300);
    pointer('pointerdown', 'touch', screen.getByRole('button', { name: 'Elsewhere' }));
    assert.equal(isShown(), false);
  });
});
