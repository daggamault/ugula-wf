import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Json } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent } from '../../shared/testing-dom.ts';
import { type ToastInput, ToastProvider } from '../../shared/ui/toast.tsx';
import type { RunsClient, Startable } from './client.ts';
import { inputSpanClasses, StartRunForm, StartRunPage } from './start-run-page.tsx';

HTMLElement.prototype.showPopover ??= () => undefined;

const batch: Startable = {
  graphId: 'g1',
  name: 'Batch',
  version: 2,
  signature: {
    execIn: ['exec'],
    execOut: [],
    inputs: [
      { name: 'limit', type: 'integer', default: 10 },
      { name: 'label', type: 'string' }
    ],
    outputs: []
  }
};

const startWith = (
  start: RunsClient['start'],
  target: Startable = batch,
  toasts: ToastInput[] = []
) =>
  render(
    createElement(
      ToastProvider,
      { onNotify: (t) => toasts.push(t) },
      createElement(StartRunForm, { client: { start } as unknown as RunsClient, target })
    )
  );

describe('StartRunForm', () => {
  it('renders a typed field per workflow input with defaults', () => {
    const html = renderToStaticMarkup(
      createElement(StartRunForm, {
        client: {} as RunsClient,
        target: {
          ...batch,
          signature: {
            ...batch.signature,
            inputs: [
              { name: 'limit', type: 'integer', default: 10 },
              { name: 'items', type: { list: { object: {} } } }
            ]
          }
        }
      })
    );
    assert.ok(html.includes('for="input-limit"') && html.includes('>Limit'));
    assert.ok(html.includes('value="10"'));
    assert.ok(html.includes('Add Item'));
    assert.ok(html.includes('href="/workflows/g1"') && html.includes('>Cancel<'));
  });

  it('says when a workflow takes no inputs', () => {
    const html = renderToStaticMarkup(
      createElement(StartRunForm, {
        client: {} as RunsClient,
        target: { ...batch, signature: { ...batch.signature, inputs: [] } }
      })
    );
    assert.ok(html.includes('This workflow takes no inputs.') && !html.includes('id="input-'));
  });

  it('starts the run with the defaults and typed values, then opens it', async () => {
    const calls: [string, Record<string, Json>][] = [];
    const toasts: ToastInput[] = [];
    startWith(
      async (graphId, inputs) => {
        calls.push([graphId, inputs]);
        return { id: 'r9', version: 2 };
      },
      batch,
      toasts
    );
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Label' }), 'Night');
    await user.click(screen.getByRole('button', { name: 'Start Run' }));
    assert.deepEqual(calls, [['g1', { limit: 10, label: 'Night' }]]);
    assert.deepEqual(
      toasts.map((t) => t.title),
      ['Batch v2 started']
    );
    assert.equal(window.location.pathname, '/runs/r9');
  });

  it('sends a cleared optional input as null', async () => {
    const calls: Record<string, Json>[] = [];
    startWith(async (_, inputs) => {
      calls.push(inputs);
      return { id: 'r1', version: 2 };
    });
    const user = userEvent.setup();
    await user.clear(screen.getByRole('spinbutton', { name: 'Limit' }));
    await user.click(screen.getByRole('button', { name: 'Start Run' }));
    assert.deepEqual(calls, [{ limit: null, label: null }]);
  });

  it('locks the inputs while the run starts', async () => {
    startWith(() => new Promise(() => undefined));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Start Run' }));
    assert.equal(
      screen.getByRole('button', { name: 'Start Run' }).getAttribute('aria-busy'),
      'true'
    );
    assert.equal(
      screen.getByRole('textbox', { name: 'Label' }).closest('fieldset')?.disabled,
      true
    );
    assert.equal(window.location.pathname, '/');
  });

  it('shows why the run did not start and lets the user try again', async () => {
    let attempts = 0;
    startWith(async () => {
      attempts += 1;
      throw new Error('Batch has no published version');
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Start Run' }));
    assert.equal((await screen.findByRole('alert')).textContent, 'Batch has no published version');
    assert.equal(
      screen.getByRole('textbox', { name: 'Label' }).closest('fieldset')?.disabled,
      false
    );
    await user.click(screen.getByRole('button', { name: 'Start Run' }));
    assert.equal(attempts, 2);
    assert.equal(window.location.pathname, '/');
  });
});

describe('StartRunPage', () => {
  it('names the published version it will run once loaded', async () => {
    render(
      createElement(StartRunPage, {
        live: idleLive,
        client: { startable: async () => batch } as unknown as RunsClient,
        graphId: 'g1'
      })
    );
    assert.ok(await screen.findByRole('heading', { name: 'Run Batch' }));
    assert.ok(screen.getByText('Runs published version 2.'));
  });

  it('explains a workflow that cannot be started', async () => {
    render(
      createElement(StartRunPage, {
        live: idleLive,
        client: {
          startable: async () => {
            throw new Error('Batch has no published version');
          }
        } as unknown as RunsClient,
        graphId: 'g1'
      })
    );
    assert.equal((await screen.findByRole('alert')).textContent, 'Batch has no published version');
    assert.ok(screen.getByRole('heading', { name: 'Start a Run' }));
    assert.ok(!screen.queryByRole('button', { name: 'Start Run' }));
  });
});

describe('inputSpanClasses', () => {
  it('gives scalars one grid column, files two and structured values a whole row', () => {
    assert.equal(inputSpanClasses('integer'), '');
    assert.equal(
      inputSpanClasses({ object: { bucket: 'string', key: 'string' } }),
      '@lg:col-span-2'
    );
    assert.equal(inputSpanClasses({ list: 'string' }), '@lg:col-span-2 @3xl:col-span-4');
    assert.equal(inputSpanClasses('any'), '@lg:col-span-2 @3xl:col-span-4');
  });
});
