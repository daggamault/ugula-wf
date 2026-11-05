import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { addToast, TOAST_LIMIT, Toaster, ToastProvider } from './toast.tsx';

describe('addToast', () => {
  it('keeps the newest few and updates a repeat of the same message in place, keeping its timer', () => {
    const toasts = Array.from({ length: TOAST_LIMIT + 2 }, (_, i) => ({ id: i, title: `T${i}` }));
    const kept = toasts.reduce(addToast, []);
    assert.deepEqual(
      kept.map((t) => t.id),
      [2, 3, 4, 5]
    );
    const repeated = addToast(kept, { id: 9, title: 'T3', description: 'Again' });
    assert.deepEqual(
      repeated.map((t) => [t.id, t.description]),
      [
        [2, undefined],
        [3, 'Again'],
        [4, undefined],
        [5, undefined]
      ]
    );
    const keyed = addToast(repeated, { id: 10, key: 'T2', title: 'Something else' });
    assert.deepEqual(
      keyed.map((t) => [t.id, t.title]),
      [
        [2, 'Something else'],
        [3, 'T3'],
        [4, 'T4'],
        [5, 'T5']
      ]
    );
  });
});

describe('Toaster', () => {
  it('announces notifications from one persistent live region with its action and a dismiss button', () => {
    const html = renderToStaticMarkup(
      createElement(Toaster, {
        toasts: [
          { id: 1, title: 'PCR-1 approved', description: 'Next up: PCR-2' },
          {
            id: 2,
            intent: 'danger',
            title: 'Upload failed',
            action: { label: 'Open Imports', to: '/imports' }
          }
        ],
        onDismiss: () => undefined
      })
    );
    assert.ok(html.includes('aria-label="Notifications"'));
    assert.ok(html.includes('aria-live="polite"') && !/role="(alert|status)"/.test(html));
    assert.ok(html.includes('Next up: PCR-2'));
    assert.ok(html.includes('href="/imports"') && html.includes('>Open Imports</a>'));
    assert.equal(html.match(/aria-label="Dismiss"/g)?.length, 2);
    assert.ok(html.includes('lucide-circle-check') && html.includes('size-4 text-success'));
    assert.ok(html.includes('lucide-circle-alert') && html.includes('size-4 text-danger'));
    assert.ok(html.includes('rounded-xl') && html.includes('shadow-lg'));
  });

  it('renders an empty live region under its children from the provider', () => {
    const html = renderToStaticMarkup(createElement(ToastProvider, null, 'App'));
    assert.ok(html.startsWith('App<section'));
  });
});
