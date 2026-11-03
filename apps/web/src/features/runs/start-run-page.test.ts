import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import type { RunsClient } from './client.ts';
import { inputSpanClasses, StartRunForm, StartRunPage } from './start-run-page.tsx';

describe('StartRunPage', () => {
  it('renders a typed field per workflow input with defaults', () => {
    const html = renderToStaticMarkup(
      createElement(StartRunForm, {
        client: {} as RunsClient,
        target: {
          graphId: 'g1',
          name: 'Batch',
          version: 2,
          signature: {
            execIn: ['exec'],
            execOut: [],
            inputs: [
              { name: 'limit', type: 'integer', default: 10 },
              { name: 'items', type: { list: { object: {} } } }
            ],
            outputs: []
          }
        }
      })
    );
    assert.ok(html.includes('id="input-limit"'));
    assert.ok(html.includes('value="10"'));
    assert.ok(html.includes('<textarea'));
    assert.ok(html.includes('Start Run'));
    assert.ok(html.includes('@3xl:grid-cols-4') && html.includes('href="/workflows/g1"'));
    assert.ok(html.includes('>Cancel<'));
    assert.ok(html.includes('for="input-limit"') && html.includes('>Limit'));
  });

  it('says when a workflow takes no inputs', () => {
    const html = renderToStaticMarkup(
      createElement(StartRunForm, {
        client: {} as RunsClient,
        target: {
          graphId: 'g1',
          name: 'Batch',
          version: 2,
          signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] }
        }
      })
    );
    assert.ok(html.includes('This workflow takes no inputs.') && !html.includes('id="input-'));
  });

  it('gives scalars one grid column, files two and structured values a whole row', () => {
    assert.equal(inputSpanClasses('integer'), '');
    assert.equal(
      inputSpanClasses({ object: { bucket: 'string', key: 'string' } }),
      '@lg:col-span-2'
    );
    assert.equal(inputSpanClasses({ list: 'string' }), '@lg:col-span-2 @3xl:col-span-4');
    assert.equal(inputSpanClasses('any'), '@lg:col-span-2 @3xl:col-span-4');
  });

  it('shows a heading while loading the workflow', () => {
    const html = renderToStaticMarkup(
      createElement(StartRunPage, {
        live: idleLive,
        client: { startable: async () => ({}) } as unknown as RunsClient,
        graphId: 'g1'
      })
    );
    assert.ok(html.includes('Start a Run'));
  });
});
