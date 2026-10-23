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
    assert.ok(up.includes('Live Updates On'));

    const down = render('offline');
    assert.ok(down.includes('bg-danger'));
    assert.ok(down.includes('Live Updates Off, Reconnecting'));

    assert.ok(render('connecting').includes('bg-warning'));
  });
});
