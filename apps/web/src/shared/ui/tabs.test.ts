import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Tabs } from './tabs.tsx';

describe('Tabs', () => {
  it('renders linked pills, marking the current one and showing counts', () => {
    const html = renderToStaticMarkup(
      createElement(Tabs, {
        label: 'Claim sections',
        tabs: [
          { label: 'Overview', href: '/claims/c1', isSelected: true },
          { label: 'History', href: '/claims/c1?tab=history', isSelected: false, count: 3 }
        ]
      })
    );
    assert.ok(html.includes('aria-label="Claim sections"'));
    assert.match(html, /<a href="\/claims\/c1" aria-current="page"/);
    assert.equal(html.match(/aria-current/g)?.length, 1);
    assert.ok(html.includes('rounded-full') && html.includes('>3<'));
    assert.ok(html.includes('aria-[current=page]:bg-primary'));
    assert.ok(!html.includes('shadow'));
  });
});
