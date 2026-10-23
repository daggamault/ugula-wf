import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import type { ImportsClient } from './client.ts';
import { FilePicker, ImportsPage } from './imports-page.tsx';

describe('FilePicker', () => {
  it('is one large labelled target for several XML files that explains what importing does', () => {
    const html = renderToStaticMarkup(
      createElement(FilePicker, { busy: false, onFiles: () => undefined })
    );
    assert.ok(html.includes('for="import-files"'));
    assert.ok(html.includes('type="file"') && html.includes('multiple'));
    assert.ok(html.includes('accept=".xml,application/xml,text/xml"'));
    assert.ok(html.includes('Drop NEMSIS files anywhere'));
    assert.ok(html.includes('anything uncertain goes to a queue'));
  });

  it('shows progress and blocks new picks while importing', () => {
    const html = renderToStaticMarkup(
      createElement(FilePicker, { busy: true, onFiles: () => undefined })
    );
    assert.ok(html.includes('aria-busy="true"') && html.includes('Importing…'));
    assert.ok(html.includes('disabled'));
  });
});

describe('ImportsPage', () => {
  it('pairs the picker with recent imports', () => {
    const client = { list: () => new Promise(() => undefined) } as unknown as ImportsClient;
    const html = renderToStaticMarkup(createElement(ImportsPage, { client, live: idleLive }));
    assert.ok(html.includes('Recent Imports'));
    assert.ok(html.includes('SFTP folder'));
  });
});
