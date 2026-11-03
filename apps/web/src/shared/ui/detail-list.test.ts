import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Detail, DetailList } from './detail-list.tsx';

describe('DetailList', () => {
  it('renders terms and values, emphasizing key figures', () => {
    const html = renderToStaticMarkup(
      createElement(
        DetailList,
        null,
        createElement(Detail, { label: 'Total', isEmphasized: true, children: '$10.00' }),
        createElement(Detail, { label: 'Born', children: '1958-04-12' })
      )
    );
    assert.match(html, /<dl[^>]*><div[^>]*><dt[^>]*>Total<\/dt><dd/);
    assert.ok(html.includes('text-xl font-bold tracking-tight tabular-nums">$10.00</dd>'));
    assert.ok(html.includes('class="break-words text-sm">1958-04-12</dd>'));
    assert.ok(html.includes('1958-04-12'));
  });
});
