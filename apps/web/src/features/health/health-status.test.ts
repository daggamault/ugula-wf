import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import type { LiveStatus } from '../../shared/live.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import { HealthStatus } from './health-status.tsx';

const show = (status: LiveStatus) => {
  render(createElement(HealthStatus, { status }));
  const region = screen.getByRole('status');
  const dot = region.querySelector('[aria-hidden="true"]');
  assert.ok(dot);
  return { region, dot };
};

describe('HealthStatus', () => {
  it('announces that live updates are on with a green dot', () => {
    const { region, dot } = show('online');
    assert.equal(region.textContent, 'Live updates on');
    assert.equal(dot.className, 'size-2 rounded-full ring-4 bg-success ring-success/25');
  });

  it('announces that live updates are off with a red dot', () => {
    const { region, dot } = show('offline');
    assert.equal(region.textContent, 'Live updates off, reconnecting');
    assert.equal(dot.className, 'size-2 rounded-full ring-4 bg-danger ring-danger/25');
  });

  it('announces the connection attempt with a pulsing amber dot', () => {
    const { region, dot } = show('connecting');
    assert.equal(region.textContent, 'Connecting to live updates');
    assert.equal(
      dot.className,
      'size-2 rounded-full ring-4 bg-warning ring-warning/25 animate-pulse'
    );
  });

  it('explains the dot in a tooltip on hover', async () => {
    const { region } = show('offline');
    const tooltip = region.nextElementSibling;
    assert.ok(tooltip);
    assert.equal(tooltip.textContent, 'Live updates off, reconnecting');
    assert.equal(tooltip.matches(':popover-open'), false);
    const user = userEvent.setup();
    await user.hover(region);
    await waitFor(() => assert.equal(tooltip.matches(':popover-open'), true));
    await user.unhover(region);
    assert.equal(tooltip.matches(':popover-open'), false);
    assert.ok(
      within(region).queryByText('Live updates off, reconnecting')?.className === 'sr-only'
    );
  });
});
