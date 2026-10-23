import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import type { ImportsClient } from './client.ts';
import { ImportsPage } from './imports-page.tsx';

const live = idleLive;

describe('ImportsPage', () => {
  it('renders a labelled XML file picker with a disabled submit until a file is chosen', () => {
    const client = { list: () => new Promise(() => undefined) } as unknown as ImportsClient;
    const html = renderToStaticMarkup(createElement(ImportsPage, { client, live }));
    assert.ok(html.includes('for="import-file"'));
    assert.ok(html.includes('type="file"'));
    assert.ok(html.includes('accept=".xml,application/xml,text/xml"'));
    assert.ok(html.includes('aria-disabled="true"'));
    assert.ok(html.includes('Choose a file first.'));
    assert.ok(html.includes('Recent Imports'));
  });
});
