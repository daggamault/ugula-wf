import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportsPage } from './reports-page.tsx';

describe('ReportsPage', () => {
  it('lists the reports that can be run', () => {
    const html = renderToStaticMarkup(createElement(ReportsPage));
    assert.ok(html.includes('href="/reports/remittances"'));
    assert.ok(html.includes('payments that matched no claim'));
  });
});
