import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Section, SectionPanel } from './section-panel.tsx';

describe('SectionPanel', () => {
  it('labels the panel by its heading and renders actions and content', () => {
    const html = renderToStaticMarkup(
      createElement(SectionPanel, {
        title: 'Payers',
        description: 'Billed in order.',
        actions: createElement('button', { type: 'button' }, 'Save'),
        children: 'List'
      })
    );
    assert.match(html, /<section aria-labelledby="([^"]+)".*<h2 id="\1"/);
    assert.ok(html.includes('Billed in order.'));
    assert.ok(html.includes('<button type="button">Save</button>'));
    assert.ok(html.includes('border-border'));
    assert.ok(html.includes('rounded-xl') && html.includes('p-5'));
    assert.ok(html.includes('items-center justify-between gap-4'));
    assert.ok(html.includes('text-base font-bold'));
    assert.ok(!html.includes('shadow'));
  });

  it('highlights an accented panel', () => {
    const html = renderToStaticMarkup(
      createElement(SectionPanel, { title: 'Decision', accent: 'primary' })
    );
    assert.ok(html.includes('border-primary/40'));
    assert.ok(!html.includes('shadow'));
    const custom = renderToStaticMarkup(
      createElement(SectionPanel, { title: 'Changed', accent: 'custom' })
    );
    assert.ok(custom.includes('border-custom/40'));
  });
});

describe('Section', () => {
  it('renders an unframed labelled section', () => {
    const html = renderToStaticMarkup(createElement(Section, { title: 'Queues', children: 'T' }));
    assert.match(html, /<section aria-labelledby="([^"]+)".*<h2 id="\1"/);
    assert.ok(html.includes('Queues'));
  });
});
