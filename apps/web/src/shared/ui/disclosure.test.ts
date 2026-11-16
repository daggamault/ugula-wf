import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Disclosure } from './disclosure.tsx';

describe('Disclosure', () => {
  it('starts collapsed behind a focusable summary', () => {
    const html = renderToStaticMarkup(
      createElement(Disclosure, { title: 'Functions', children: 'body' })
    );
    assert.ok(html.startsWith('<details') && !html.includes('<details open'));
    assert.ok(html.includes('<summary') && html.includes('>Functions</summary>'));
    assert.ok(
      html.includes('focus-visible:outline-primary') && html.includes('group-open:rotate-90')
    );
    assert.ok(html.includes('text-sm font-semibold') && !html.includes('rounded-xl'));
  });

  it('stands as its own panel with a section title', () => {
    const html = renderToStaticMarkup(
      createElement(Disclosure, { title: 'Advanced', isPanel: true, children: 'body' })
    );
    assert.ok(html.includes('bg-surface') && html.includes('rounded-xl border p-5'));
    assert.ok(html.includes('text-base font-bold'));
  });
});
