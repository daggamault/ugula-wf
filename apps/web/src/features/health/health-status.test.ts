import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HealthStatus } from './health-status.tsx';

describe('HealthStatus', () => {
  it('shows a success dot when online and a danger dot when offline', () => {
    const up = renderToStaticMarkup(createElement(HealthStatus, { online: true }));
    assert.ok(up.includes('role="status"'));
    assert.ok(up.includes('bg-success'));
    assert.ok(up.includes('Live Updates On'));

    const down = renderToStaticMarkup(createElement(HealthStatus, { online: false }));
    assert.ok(down.includes('bg-danger'));
    assert.ok(down.includes('Live Updates Off'));
  });
});
