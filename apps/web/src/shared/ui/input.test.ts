import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Input } from './input.tsx';

describe('Input', () => {
  it('renders label, input, and linked error description when error is provided', () => {
    const html = renderToStaticMarkup(
      createElement(Input, { id: 'email', label: 'Email', error: 'Required' })
    );
    assert.ok(html.includes('for="email"'));
    assert.ok(html.includes('aria-invalid="true"'));
    assert.ok(html.includes('aria-describedby="email-error"'));
    assert.ok(html.includes('<span id="email-error"'));
  });
});
