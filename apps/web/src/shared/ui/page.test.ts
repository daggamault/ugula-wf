import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyState } from './empty-state.tsx';
import { Page, PageFailure, PageLoading, WorkspaceHeader } from './page.tsx';

describe('Page', () => {
  it('renders a titled section with description, actions and content', () => {
    const html = renderToStaticMarkup(
      createElement(
        Page,
        {
          title: 'Runs',
          description: 'All runs',
          actions: createElement('button', { type: 'button' }, 'New')
        },
        createElement(EmptyState, { title: 'Nothing Yet' })
      )
    );
    assert.ok(html.startsWith('<section class="flex flex-col gap-6 p-4 sm:p-6 lg:p-10'));
    assert.ok(html.includes('text-2xl/9 font-extrabold tracking-tight'));
    assert.ok(html.includes('>Runs</h1>'));
    assert.ok(html.includes('All runs'));
    assert.ok(html.includes('<button type="button">New</button>'));
    assert.ok(html.includes('Nothing Yet'));
    assert.ok(!html.includes('aria-label="Back'));
  });

  it('puts a labelled back link before the title', () => {
    const html = renderToStaticMarkup(
      createElement(Page, { title: 'Claim', backTo: '/claims', backLabel: 'Back to Claims' })
    );
    assert.match(html, /href="\/claims" aria-label="Back to Claims".*<h1/);
    const plain = renderToStaticMarkup(createElement(Page, { title: 'Claim', backTo: '/claims' }));
    assert.ok(plain.includes('aria-label="Back"'));
  });
});

describe('WorkspaceHeader', () => {
  it('heads a full-height workspace with breadcrumbs, back link and actions', () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceHeader, {
        title: 'Process PCR',
        backTo: '/workflows',
        backLabel: 'Back to Workflows',
        breadcrumbs: createElement('nav', null, 'Path'),
        actions: createElement('button', { type: 'button' }, 'Publish')
      })
    );
    assert.ok(html.startsWith('<header'));
    assert.match(html, /<nav>Path<\/nav>.*aria-label="Back to Workflows".*>Process PCR<\/h1>/);
    assert.ok(html.includes('<button type="button">Publish</button>'));
  });
});

describe('PageLoading', () => {
  it('announces loading', () => {
    assert.ok(renderToStaticMarkup(createElement(PageLoading)).includes('role="status"'));
  });
});

describe('PageFailure', () => {
  it('explains a failure under a Title Case top-level heading', () => {
    const html = renderToStaticMarkup(createElement(PageFailure, { message: 'Claim not found.' }));
    assert.ok(html.includes('<h1 class="text-base font-bold">Something Went Wrong</h1>'));
    assert.ok(html.includes('Claim not found.'));
  });
});
