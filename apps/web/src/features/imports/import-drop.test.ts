import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { carriesFiles, DropOverlay, ImportDrop } from './import-drop.tsx';

describe('ImportDrop', () => {
  it('reacts only to drags that carry files', () => {
    assert.equal(
      carriesFiles({ dataTransfer: { types: ['Files'] } as unknown as DataTransfer }),
      true
    );
    assert.equal(
      carriesFiles({ dataTransfer: { types: ['text/plain'] } as unknown as DataTransfer }),
      false
    );
    assert.equal(carriesFiles({ dataTransfer: null }), false);
  });

  it('stays out of the way until a file is dragged over the window', () => {
    const html = renderToStaticMarkup(
      createElement(ImportDrop, {
        client: { upload: async () => ({ runId: 'r', file: {} }) } as never
      })
    );
    assert.equal(html, '');
  });

  it('explains what dropping does', () => {
    const html = renderToStaticMarkup(createElement(DropOverlay));
    assert.ok(html.includes('Drop NEMSIS files to import'));
    assert.ok(html.includes('aria-hidden="true"'));
  });
});
