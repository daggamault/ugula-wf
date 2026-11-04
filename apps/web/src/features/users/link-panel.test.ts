import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LinkPanel } from './link-panel.tsx';

describe('LinkPanel', () => {
  it('shows a read-only link with a copy action', () => {
    const html = renderToStaticMarkup(
      createElement(LinkPanel, {
        title: 'Invitation for Ann Lee',
        description: 'Send this link.',
        link: 'http://app.test/invitation?token=t1'
      })
    );
    assert.ok(html.includes('Invitation for Ann Lee') && html.includes('Send this link.'));
    assert.ok(html.includes('value="http://app.test/invitation?token=t1"'));
    assert.ok(html.includes('readOnly=""'));
    assert.ok(html.includes('Copy Link'));
  });
});
