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
    assert.ok(html.includes('<p id="email-error" role="alert"'));
  });

  it('links a hint, hides the label on request and keeps the control height', () => {
    const html = renderToStaticMarkup(
      createElement(Input, {
        id: 'q',
        label: 'Search',
        hint: 'Name or ID',
        isLabelHidden: true,
        isMonospace: true,
        required: true
      })
    );
    assert.ok(html.includes('aria-describedby="q-hint"') && !html.includes('aria-invalid='));
    assert.ok(html.includes('class="text-sm font-medium sr-only"'));
    assert.ok(html.includes('h-10') && html.includes('rounded-lg') && html.includes('font-mono'));
    assert.ok(html.includes('focus-visible:outline-primary') && html.includes('required=""'));
    assert.ok(html.includes('aria-hidden="true" class="text-danger ml-0.5">*</span>'));
  });
});
