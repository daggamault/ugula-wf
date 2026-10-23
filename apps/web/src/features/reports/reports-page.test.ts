import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReportsClient } from './client.ts';
import { defaultRange, ReportsPage } from './reports-page.tsx';

describe('defaultRange', () => {
  it('covers the last twelve months from the first of the month', () => {
    assert.deepEqual(defaultRange(new Date('2026-10-23T12:00:00Z')), {
      from: '2025-11-01',
      to: '2026-10-23'
    });
    assert.deepEqual(defaultRange(new Date('2026-01-05T00:00:00Z')), {
      from: '2025-02-01',
      to: '2026-01-05'
    });
  });
});

describe('ReportsPage', () => {
  it('renders every report and the period it covers while loading', () => {
    const pending = () => new Promise(() => undefined);
    const client = {
      aging: pending,
      monthly: pending,
      hcpcs: pending,
      payers: pending
    } as unknown as ReportsClient;
    const out = renderToStaticMarkup(
      createElement(ReportsPage, { client, now: new Date('2026-10-23T12:00:00Z') })
    );
    for (const title of [
      'Accounts Receivable Aging',
      'Charges and Collections by Month',
      'Payer Performance',
      'Charges by HCPCS Code'
    ]) {
      assert.ok(out.includes(title), title);
    }
    assert.ok(out.includes('value="2025-11-01"') && out.includes('value="2026-10-23"'));
  });
});
