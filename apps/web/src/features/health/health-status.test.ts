import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HealthStatus } from './health-status.tsx';

describe('HealthStatus', () => {
  it('shows whether live updates are connected', () => {
    const render = (status: 'connecting' | 'online' | 'offline') =>
      renderToStaticMarkup(createElement(HealthStatus, { status }));
    const up = render('online');
    assert.ok(up.includes('role="status"'));
    assert.ok(up.includes('bg-success'));
    assert.ok(up.includes('Live updates on'));

    const down = render('offline');
    assert.ok(down.includes('bg-danger'));
    assert.ok(down.includes('Live updates off, reconnecting'));

    const connecting = render('connecting');
    assert.ok(connecting.includes('bg-warning') && connecting.includes('animate-pulse'));
    assert.ok(connecting.includes('<span class="sr-only">Connecting to live updates</span>'));
    assert.ok(up.includes('aria-hidden="true"'));
  });
});
