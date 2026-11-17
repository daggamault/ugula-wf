import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { act, render, screen, within } from '../testing-dom.ts';
import { EmptyState } from './empty-state.tsx';
import { Page, PageFailure, PageLoading, WorkspaceHeader } from './page.tsx';

type Observed = {
  report: (ratio: number) => void;
  options: IntersectionObserverInit | undefined;
  disconnected: boolean;
};

const fakeObserver = (t: { after: (fn: () => void) => void }) => {
  const observed: Observed[] = [];
  const real = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      const entry: Observed = {
        report: (ratio) =>
          callback(
            [{ intersectionRatio: ratio } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver
          ),
        options,
        disconnected: false
      };
      observed.push(entry);
      Object.assign(this, {
        observe: () => undefined,
        disconnect: () => (entry.disconnected = true)
      });
    }
  } as unknown as typeof IntersectionObserver;
  t.after(() => {
    globalThis.IntersectionObserver = real;
  });
  return observed;
};

describe('Page', () => {
  it('heads its content with a level-one title, description and actions', () => {
    render(
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
    const header = screen.getByRole('banner');
    assert.equal(within(header).getByRole('heading', { level: 1 }).textContent, 'Runs');
    assert.equal(within(header).getByText('All runs').tagName, 'DIV');
    assert.equal(within(header).getByRole('button').textContent, 'New');
    assert.equal(screen.getByRole('heading', { level: 2 }).textContent, 'Nothing Yet');
    assert.equal(header.nextElementSibling?.contains(screen.getByText('Nothing Yet')), true);
  });

  it('leaves out the back link, description and actions when not given', () => {
    render(createElement(Page, { title: 'Runs' }));
    const header = screen.getByRole('banner');
    assert.ok(!within(header).queryByRole('link'));
    assert.ok(!within(header).queryByRole('button'));
    assert.equal(header.textContent, 'Runs');
  });

  it('puts a labelled back link before the title', () => {
    render(createElement(Page, { title: 'Claim', backTo: '/claims', backLabel: 'Back to Claims' }));
    const back = screen.getByRole('link', { name: 'Back to Claims' });
    assert.equal(back.getAttribute('href'), '/claims');
    const title = screen.getByRole('heading', { level: 1 });
    assert.equal(
      back.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('names the back link "Back" by default', () => {
    render(createElement(Page, { title: 'Claim', backTo: '/claims' }));
    assert.equal(screen.getByRole('link', { name: 'Back' }).getAttribute('href'), '/claims');
  });

  it('frosts the header only while it is stuck to the top', (t) => {
    const observed = fakeObserver(t);
    const { unmount } = render(createElement(Page, { title: 'Runs' }));
    const header = screen.getByRole('banner');
    const [observer] = observed;
    assert.equal(observed.length, 1);
    assert.deepEqual(observer?.options, { threshold: 1 });
    assert.equal(header.classList.contains('backdrop-blur-md'), false);
    act(() => observer?.report(0.5));
    assert.equal(header.classList.contains('backdrop-blur-md'), true);
    act(() => observer?.report(1));
    assert.equal(header.classList.contains('backdrop-blur-md'), false);
    unmount();
    assert.equal(observer?.disconnected, true);
  });
});

describe('WorkspaceHeader', () => {
  it('heads a workspace with breadcrumbs, then the back link and title, then actions', () => {
    render(
      createElement(WorkspaceHeader, {
        title: 'Process PCR',
        description: 'Draft',
        backTo: '/workflows',
        backLabel: 'Back to Workflows',
        breadcrumbs: createElement('nav', { 'aria-label': 'Path' }, 'Path'),
        actions: createElement('button', { type: 'button' }, 'Publish')
      })
    );
    const header = screen.getByRole('banner');
    const order = [
      within(header).getByRole('navigation', { name: 'Path' }),
      within(header).getByRole('link', { name: 'Back to Workflows' }),
      within(header).getByRole('heading', { level: 1, name: 'Process PCR' }),
      within(header).getByText('Draft'),
      within(header).getByRole('button', { name: 'Publish' })
    ];
    for (const [i, el] of order.slice(1).entries()) {
      assert.equal(
        (order[i]?.compareDocumentPosition(el) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
        Node.DOCUMENT_POSITION_FOLLOWING
      );
    }
    assert.equal(
      within(header).getByRole('link', { name: 'Back to Workflows' }).getAttribute('href'),
      '/workflows'
    );
  });

  it('shows just the title when nothing else is given', () => {
    render(createElement(WorkspaceHeader, { title: 'Process PCR' }));
    const header = screen.getByRole('banner');
    assert.ok(!within(header).queryByRole('link'));
    assert.equal(header.textContent, 'Process PCR');
  });
});

describe('PageLoading', () => {
  it('announces loading', () => {
    render(createElement(PageLoading));
    assert.equal(screen.getByRole('status', { name: 'Loading' }).tagName, 'SPAN');
  });
});

describe('PageFailure', () => {
  it('explains a failure under a Title Case top-level heading', () => {
    render(createElement(PageFailure, { message: 'Claim not found.' }));
    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Something Went Wrong');
    assert.equal(screen.getByText('Claim not found.').tagName, 'P');
  });
});
