import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LiveEvent } from '@ugula/live';
import { createElement } from 'react';
import type { ClaimSummary } from '../../shared/claims/claim-detail.ts';
import type { Live } from '../../shared/live.ts';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, waitFor, within } from '../../shared/testing-dom.ts';
import type { Page } from '../../shared/url-state.ts';
import type { ClaimsClient } from './client.ts';
import { PatientClaims } from './patient-claims.tsx';

const claim: ClaimSummary = {
  id: 'c1',
  number: '20261001-0012',
  patient_number: '20260915-0003',
  pcr_number: null,
  encounter_number: '20261001-0007',
  level: 'ALS1',
  total_cents: 114_220,
  balance_cents: 30_000,
  service_date: '2026-10-01',
  payers: ['Medicare'],
  status: 'submitted',
  created_at: '2026-10-01T00:00:00Z',
  first_name: 'Jane',
  last_name: 'Doe',
  task_id: null,
  task_title: null,
  task_queue: null,
  task_kind: null,
  task_assignee_email: null,
  open_tasks: 0
};

const pageOf = (items: ClaimSummary[], total = items.length): Page<ClaimSummary> => ({
  items,
  total,
  page: 1,
  pageSize: 25
});

const fakeClient = (list: () => Promise<Page<ClaimSummary>> = async () => pageOf([claim])) => {
  const calls: Parameters<ClaimsClient['list']>[] = [];
  const client: Pick<ClaimsClient, 'list'> = {
    list: (query, page) => {
      calls.push([query, page]);
      return list();
    }
  };
  return { client, calls };
};

const show = (client: Pick<ClaimsClient, 'list'>, live: Live = idleLive) =>
  render(createElement(PatientClaims, { client, live, patientId: 'p1' }));

const section = () => screen.getByRole('region', { name: 'Claims' });

describe('PatientClaims', () => {
  it('shows it is loading in the Claims section until the claims arrive', () => {
    const { client } = fakeClient(() => new Promise(() => undefined));
    show(client);
    assert.ok(within(section()).getByLabelText('Loading'));
  });

  it("lists the patient's claims without repeating the patient", async () => {
    const { client, calls } = fakeClient();
    show(client);
    const table = await screen.findByRole('table', { name: 'Claims' });
    assert.deepEqual(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
      [
        'Claim',
        'Encounter',
        'Service Date',
        'Total',
        'Balance',
        'Payers',
        'Status',
        'Waiting On',
        'Actions'
      ]
    );
    const rows = within(table).getAllByRole('row');
    assert.equal(rows.length, 2);
    assert.deepEqual(
      within(rows[1] as HTMLElement)
        .getAllByRole('cell')
        .slice(0, 7)
        .map((c) => c.textContent),
      [
        '20261001-0012',
        'Encounter20261001-0007',
        'Service DateOct 1, 2026',
        'Total$1,142.20',
        'Balance$300.00',
        'PayersMedicare',
        'StatusSubmitted'
      ]
    );
    assert.deepEqual(calls, [[{ patientId: 'p1' }, 'page=1&pageSize=25&sort=created&dir=desc']]);
  });

  it('opens a claim and comes back to the patient', async () => {
    window.history.replaceState(null, '', '/patients/p1');
    const { client } = fakeClient();
    show(client);
    const open = await screen.findByRole('link', { name: 'Open claim 20261001-0012' });
    assert.equal(open.getAttribute('href'), '/claims/c1?back=%2Fpatients%2Fp1');
  });

  it('says when the patient has no claims yet', async () => {
    const { client } = fakeClient(async () => pageOf([]));
    show(client);
    assert.ok(await screen.findByText('No claims for this patient yet.'));
    assert.ok(!screen.queryByRole('table'));
  });

  it('says why the claims could not be loaded', async () => {
    const { client } = fakeClient(async () => {
      throw new Error('Claims are unavailable');
    });
    show(client);
    assert.equal((await screen.findByRole('alert')).textContent, 'Claims are unavailable');
    assert.ok(within(section()).getByText('No claims for this patient yet.'));
  });

  it('reloads past the first page only when a listed claim changes', async () => {
    window.history.replaceState(null, '', '/patients/p1?page=2');
    const listeners: ((e: LiveEvent | null) => void)[] = [];
    const live: Live = {
      ...idleLive,
      subscribe: (listener) => {
        listeners.push(listener);
        return () => undefined;
      }
    };
    const { client, calls } = fakeClient(async () => pageOf([claim], 30));
    show(client, live);
    await screen.findByRole('table', { name: 'Claims' });
    assert.equal(calls[0]?.[1], 'page=2&pageSize=25&sort=created&dir=desc');
    const emit = (e: LiveEvent) => {
      for (const listener of listeners) listener(e);
    };
    emit({ kind: 'claim', id: 'c9' });
    emit({ kind: 'task', id: 'c1', runId: null });
    await new Promise((r) => setTimeout(r, 1_700));
    assert.equal(calls.length, 1);
    emit({ kind: 'claim', id: 'c1' });
    await waitFor(() => assert.equal(calls.length, 2), { timeout: 2_500 });
  });
});
