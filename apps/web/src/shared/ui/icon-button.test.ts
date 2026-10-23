import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PencilIcon, Trash2Icon } from 'lucide-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IconButton, IconLink } from './icon-button.tsx';

describe('IconButton', () => {
  it('labels an icon-only button and tints danger actions', () => {
    const html = renderToStaticMarkup(
      createElement(IconButton, { label: 'Delete fee', icon: Trash2Icon, intent: 'danger' })
    );
    assert.ok(html.includes('aria-label="Delete fee"'));
    assert.ok(html.includes('type="button"'));
    assert.ok(html.includes('hover:text-danger'));
    assert.ok(html.includes('cursor-pointer'));
  });

  it('stays focusable when blocked and explains why', () => {
    const html = renderToStaticMarkup(
      createElement(IconButton, { label: 'Move up', icon: PencilIcon, disabledReason: 'First.' })
    );
    assert.ok(html.includes('aria-disabled="true"'));
    assert.ok(html.includes('First.'));
  });
});

describe('IconLink', () => {
  it('renders a labelled icon link', () => {
    const html = renderToStaticMarkup(
      createElement(IconLink, { to: '/runs', label: 'Back to Runs', icon: PencilIcon })
    );
    assert.ok(html.includes('href="/runs"'));
    assert.ok(html.includes('aria-label="Back to Runs"'));
  });
});
