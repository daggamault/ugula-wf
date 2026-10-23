import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Alert } from './alert.tsx';

describe('Alert', () => {
  it('announces danger as an alert and other intents as status', () => {
    const danger = renderToStaticMarkup(createElement(Alert, { children: 'Invalid credentials' }));
    assert.ok(danger.includes('role="alert"'));
    assert.ok(danger.includes('text-danger'));
    assert.ok(danger.includes('Invalid credentials'));

    const info = renderToStaticMarkup(
      createElement(Alert, { intent: 'info', children: 'Heads up' })
    );
    assert.ok(info.includes('role="status"'));
    assert.ok(info.includes('bg-info/10'));
  });

  it('renders actions beside the message', () => {
    const html = renderToStaticMarkup(
      createElement(Alert, {
        intent: 'warning',
        action: createElement('button', { type: 'button' }, 'Fix'),
        children: 'Needs setup'
      })
    );
    assert.ok(html.includes('<button type="button">Fix</button>'));
  });
});
