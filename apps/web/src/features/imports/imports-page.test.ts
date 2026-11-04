import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import type { ImportsClient } from './client.ts';
import { ImportsPage } from './imports-page.tsx';

describe('ImportsPage', () => {
  it('puts the import button in the header, searches imports and explains drop and SFTP', () => {
    const client = { list: () => new Promise(() => undefined) } as unknown as ImportsClient;
    const html = renderToStaticMarkup(createElement(ImportsPage, { client, live: idleLive }));
    assert.ok(html.includes('Import Files') && html.includes('aria-label="Search Imports"'));
    assert.ok(html.includes('accept=".xml,application/xml,text/xml"') && html.includes('multiple'));
    assert.ok(html.includes('anywhere in the app') && html.includes('SFTP folder'));
  });
});
