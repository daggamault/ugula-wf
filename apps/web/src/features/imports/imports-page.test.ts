import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import type { ImportsClient } from './client.ts';
import { ImportButton, ImportsPage } from './imports-page.tsx';

describe('ImportButton', () => {
  it('is a focusable button that opens a picker for several XML files', () => {
    const html = renderToStaticMarkup(
      createElement(ImportButton, { busy: false, onFiles: () => undefined })
    );
    assert.ok(html.includes('<button type="button"') && html.includes('Import Files'));
    assert.ok(html.includes('hidden=""') && !html.includes('<label'));
    assert.ok(html.includes('type="file"') && html.includes('multiple'));
    assert.ok(html.includes('accept=".xml,application/xml,text/xml"'));
  });

  it('shows progress and blocks new picks while importing', () => {
    const html = renderToStaticMarkup(
      createElement(ImportButton, { busy: true, onFiles: () => undefined })
    );
    assert.ok(html.includes('aria-busy="true"'));
    assert.ok(html.includes('disabled'));
  });
});

describe('ImportsPage', () => {
  it('puts the import button in the header, searches imports and explains drop and SFTP', () => {
    const client = { list: () => new Promise(() => undefined) } as unknown as ImportsClient;
    const html = renderToStaticMarkup(createElement(ImportsPage, { client, live: idleLive }));
    assert.ok(html.includes('Import Files') && html.includes('aria-label="Search Imports"'));
    assert.ok(html.includes('anywhere in the app') && html.includes('SFTP folder'));
  });
});
