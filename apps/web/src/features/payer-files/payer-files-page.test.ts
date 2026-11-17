import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor } from '../../shared/testing-dom.ts';
import { type ToastInput, ToastProvider } from '../../shared/ui/toast.tsx';
import type { PayerFileSummary, PayerFilesClient } from './client.ts';
import { PayerFilesPage, PayerFilesTable } from './payer-files-page.tsx';

const file: PayerFileSummary = {
  id: 'f1',
  kind: '835',
  file_name: 'era.835',
  control_number: '101',
  item_count: 4,
  problem_count: 1,
  created_at: '2026-10-31T12:00:00Z',
  uploaded_by: 'biller@agency.test'
};

describe('PayerFilesTable', () => {
  it('lists each file with its kind, lines and outcome', () => {
    const html = renderToStaticMarkup(createElement(PayerFilesTable, { files: [file] }));
    assert.ok(html.includes('era.835') && html.includes('Remittance (835)'));
    assert.ok(html.includes('1 of 4 needs you'));
    assert.ok(html.includes('href="/payer-files/f1" aria-label="Open payer file era.835"'));
  });
});

describe('PayerFilesPage', () => {
  const fakeClient = (over: Partial<PayerFilesClient> = {}) => {
    const queries: string[] = [];
    const uploads: string[] = [];
    const client = {
      list: async (query: string) => {
        queries.push(query);
        return { items: [file], total: 1, page: 1, pageSize: 25 };
      },
      upload: async (picked: File) => {
        uploads.push(picked.name);
        return { runId: 'run-9', kind: '835' as const };
      },
      ...over
    } as PayerFilesClient;
    return { client, queries, uploads };
  };

  const show = (client: PayerFilesClient, toasts: ToastInput[] = []) =>
    render(
      createElement(
        ToastProvider,
        { onNotify: (t) => toasts.push(t) },
        createElement(PayerFilesPage, { client, live: idleLive })
      )
    );

  const fileInput = () => {
    const input = document.querySelector('input[type="file"]');
    assert.ok(input instanceof HTMLInputElement);
    return input;
  };

  it('uploads every chosen file, links each to its run and refreshes the list', async () => {
    const toasts: ToastInput[] = [];
    const { client, queries, uploads } = fakeClient();
    show(client, toasts);
    await screen.findByRole('table', { name: 'Payer files' });
    await userEvent
      .setup()
      .upload(fileInput(), [new File(['ISA'], 'era.835'), new File(['ISA'], 'ack.999')]);
    await waitFor(() => assert.equal(queries.length, 2));
    assert.deepEqual(uploads, ['era.835', 'ack.999']);
    assert.deepEqual(toasts[0]?.action, { label: 'Open Run', to: '/runs/run-9' });
    assert.ok(await screen.findByText('era.835 received'));
  });

  it('says why a file was refused and leaves the list alone', async () => {
    const toasts: ToastInput[] = [];
    const { client, queries } = fakeClient({
      upload: () => Promise.reject(new Error('Not an X12 file'))
    });
    show(client, toasts);
    await screen.findByRole('table', { name: 'Payer files' });
    await userEvent.setup().upload(fileInput(), new File(['x'], 'notes.txt'));
    await waitFor(() => assert.equal(toasts.length, 1));
    assert.deepEqual(
      [toasts[0]?.intent, toasts[0]?.title, toasts[0]?.description],
      ['danger', 'notes.txt could not be applied', 'Not an X12 file']
    );
    assert.equal(queries.length, 1);
  });

  it('explains what to upload when there are no files yet', async () => {
    const { client } = fakeClient({
      list: async () => ({ items: [], total: 0, page: 1, pageSize: 25 })
    });
    show(client);
    assert.ok(await screen.findByText('No Payer Files Yet'));
  });

  it('searches files through the address bar', async () => {
    const { client, queries } = fakeClient();
    show(client);
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'era');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    assert.equal(window.location.search, '?q=era');
    await waitFor(() => assert.match(queries.at(-1) ?? '', /^q=era&/));
  });
});
