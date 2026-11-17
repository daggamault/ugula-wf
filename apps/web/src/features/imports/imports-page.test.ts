import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import { type ToastInput, ToastProvider } from '../../shared/ui/toast.tsx';
import type { Page } from '../../shared/url-state.ts';
import type { ImportSummary, ImportsClient } from './client.ts';
import { ImportsPage } from './imports-page.tsx';

const AGENCY = '0b1f3c2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';

const summary: ImportSummary = {
  id: 'i1',
  file_name: 'october.xml',
  source: 'upload',
  report_count: 3,
  created_at: '2026-10-20T14:00:00Z',
  run_id: 'r1',
  run_status: 'completed',
  uploaded_by_email: 'biller@example.com',
  created: 3,
  revised: 0,
  unchanged: 0,
  claims: 3,
  charges_cents: 114_220
};

const pageOf = (items: ImportSummary[]): Page<ImportSummary> => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25
});

const fakeClient = (over: Partial<ImportsClient> = {}) => {
  const queries: string[] = [];
  const uploads: [string, string | null][] = [];
  const client = {
    list: async (query: string) => {
      queries.push(query);
      return pageOf([summary]);
    },
    upload: async (file: File, agencyId: string | null) => {
      uploads.push([file.name, agencyId]);
      return {
        importId: 'i2',
        runIds: ['r2'],
        file: { bucket: 'b', key: 'k', size: 1, contentType: 'text/xml' }
      };
    },
    ...over
  } as ImportsClient;
  return { client, queries, uploads };
};

const show = (client: ImportsClient, toasts: ToastInput[] = []) =>
  render(
    createElement(
      ToastProvider,
      { onNotify: (t) => toasts.push(t) },
      createElement(ImportsPage, { client, live: idleLive })
    )
  );

const fileInput = () => {
  const input = document.querySelector('input[type="file"]');
  assert.ok(input instanceof HTMLInputElement);
  return input;
};

describe('ImportsPage', () => {
  it('lists the imported files newest first', async () => {
    const { client, queries } = fakeClient();
    show(client);
    const table = await screen.findByRole('table', { name: 'Imports' });
    assert.ok(within(table).getByText('october.xml'));
    assert.ok(within(table).getByRole('link', { name: 'Open import october.xml' }));
    assert.deepEqual(queries, ['page=1&pageSize=25&sort=received&dir=desc']);
    assert.equal(fileInput().accept, '.xml,application/xml,text/xml');
    assert.equal(fileInput().multiple, true);
  });

  it('searches imports through the address bar', async () => {
    const { client, queries } = fakeClient();
    show(client);
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'october');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    assert.equal(window.location.search, '?q=october');
    await waitFor(() => assert.match(queries.at(-1) ?? '', /^q=october&/));
  });

  it('uploads chosen XML files into the current agency and refreshes the list', async () => {
    window.history.replaceState(null, '', `/agencies/${AGENCY}/imports`);
    const toasts: ToastInput[] = [];
    const { client, queries, uploads } = fakeClient();
    show(client, toasts);
    await screen.findByRole('table', { name: 'Imports' });
    const user = userEvent.setup();
    await user.upload(fileInput(), [
      new File(['<x/>'], 'a.xml', { type: 'text/xml' }),
      new File(['<x/>'], 'b.xml', { type: 'text/xml' })
    ]);
    await waitFor(() => assert.equal(queries.length, 2));
    assert.deepEqual(uploads, [
      ['a.xml', AGENCY],
      ['b.xml', AGENCY]
    ]);
    assert.deepEqual(
      toasts.map((t) => t.title),
      ['a.xml received', 'b.xml received']
    );
  });

  it('keeps the list as it is when no file could be imported', async () => {
    const toasts: ToastInput[] = [];
    const { client, queries } = fakeClient({
      upload: () => Promise.reject(new Error('The file is empty'))
    });
    show(client, toasts);
    await screen.findByRole('table', { name: 'Imports' });
    await userEvent.setup().upload(fileInput(), new File(['<x/>'], 'a.xml', { type: 'text/xml' }));
    await waitFor(() => assert.equal(toasts.length, 1));
    assert.equal(toasts[0]?.title, 'a.xml could not be imported');
    assert.equal(queries.length, 1);
    assert.equal(
      (screen.getByRole('button', { name: 'Import Files' }) as HTMLButtonElement).disabled,
      false
    );
  });

  it('shows the import button as busy while files upload', async () => {
    let finish: () => void = () => undefined;
    const { client } = fakeClient({
      upload: () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({
              importId: 'i',
              runIds: ['r'],
              file: { bucket: 'b', key: 'k', size: 1, contentType: 'x' }
            });
        })
    });
    show(client);
    await screen.findByRole('table', { name: 'Imports' });
    await userEvent.setup().upload(fileInput(), new File(['<x/>'], 'a.xml', { type: 'text/xml' }));
    const button = screen.getByRole('button', { name: /Import Files/ });
    await waitFor(() => assert.equal(button.getAttribute('aria-busy'), 'true'));
    assert.equal(fileInput().disabled, true);
    finish();
    await waitFor(() => assert.equal(button.getAttribute('aria-busy'), null));
  });

  it('explains how to import when there are no imports yet', async () => {
    const { client } = fakeClient({ list: async () => pageOf([]) });
    show(client);
    assert.ok(await screen.findByText('No Imports Yet'));
    assert.ok(screen.getByText('Drag NEMSIS XML files onto any page, or use Import Files.'));
  });

  it('says why the imports could not load', async () => {
    const { client } = fakeClient({ list: () => Promise.reject(new Error('Server unavailable')) });
    show(client);
    assert.equal((await screen.findByRole('alert')).textContent, 'Server unavailable');
  });
});
