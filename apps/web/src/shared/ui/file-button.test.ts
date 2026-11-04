import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FileButton } from './file-button.tsx';

describe('FileButton', () => {
  it('is a focusable button that opens a picker for several files', () => {
    const html = renderToStaticMarkup(
      createElement(FileButton, {
        label: 'Import Files',
        accept: '.xml',
        busy: false,
        onFiles: () => undefined
      })
    );
    assert.ok(html.includes('<button type="button"') && html.includes('Import Files'));
    assert.ok(html.includes('lucide-file-up'));
    assert.ok(html.includes('hidden=""') && !html.includes('<label'));
    assert.ok(html.includes('type="file"') && html.includes('multiple'));
    assert.ok(html.includes('accept=".xml"') && !html.includes('disabled=""'));
  });

  it('shows progress and blocks new picks while busy', () => {
    const html = renderToStaticMarkup(
      createElement(FileButton, { label: 'Upload', busy: true, onFiles: () => undefined })
    );
    assert.ok(html.includes('aria-busy="true"') && html.includes('disabled=""'));
    assert.ok(!html.includes('accept='));
  });
});
