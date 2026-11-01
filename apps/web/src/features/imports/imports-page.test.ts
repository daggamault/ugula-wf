import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import type { ImportsClient } from './client.ts';
import { ImportButton, ImportsPage } from './imports-page.tsx';

describe('ImportButton', () => {
  it('is a labelled button for several XML files', () => {
    const html = renderToStaticMarkup(
      createElement(ImportButton, { busy: false, onFiles: () => undefined })
    );
    assert.ok(html.includes('for="import-files"') && html.includes('Import files'));
    assert.ok(html.includes('type="file"') && html.includes('multiple'));
    assert.ok(html.includes('accept=".xml,application/xml,text/xml"'));
  });

  it('shows progress and blocks new picks while importing', () => {
    const html = renderToStaticMarkup(
      createElement(ImportButton, { busy: true, onFiles: () => undefined })
    );
    assert.ok(html.includes('aria-busy="true"') && html.includes('Importing…'));
    assert.ok(html.includes('disabled'));
  });
});

describe('ImportsPage', () => {
  it('puts the import button in the header and explains drop and SFTP', () => {
    const client = { list: () => new Promise(() => undefined) } as unknown as ImportsClient;
    const html = renderToStaticMarkup(createElement(ImportsPage, { client, live: idleLive }));
    assert.ok(html.includes('Import files'));
    assert.ok(html.includes('anywhere in the app') && html.includes('SFTP folder'));
  });
});
