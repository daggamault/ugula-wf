import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RunsClient } from './client.ts';
import { StartRunForm, StartRunPage } from './start-run-page.tsx';

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
    assert.ok(html.includes('Start run'));
  });

  it('shows a heading while loading the workflow', () => {
    const html = renderToStaticMarkup(
      createElement(StartRunPage, {
        client: { startable: async () => ({}) } as unknown as RunsClient,
        graphId: 'g1'
      })
    );
    assert.ok(html.includes('Start a Run'));
  });
});
