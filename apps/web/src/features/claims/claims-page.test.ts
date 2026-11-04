import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import {
  assigneeOf,
  CLAIM_SEARCH_FIELDS,
  ClaimsPage,
  ClaimsTable,
  claimNumber
} from './claims-page.tsx';
import type { ClaimSummary, ClaimsClient } from './client.ts';

const claim: ClaimSummary = {
  id: 'c1',
  number: 12,
  patient_number: 3,
  pcr_number: 'PCR-1001',
  level: 'ALS1',
  total_cents: 114_220,
  balance_cents: 30_000,
  service_date: '2026-10-01',
  payers: ['Medicare', 'Blue Plan'],
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

describe('ClaimsTable', () => {
  it('opens each claim from an icon action and shows the patient, encounter, money and status', () => {
    const html = renderToStaticMarkup(
      createElement(ClaimsTable, { claims: [claim, { ...claim, id: 'c2', payers: [] }] })
    );
    assert.ok(html.includes('<span class="sr-only">Actions</span>'));
    assert.ok(html.includes('href="/claims/c1" aria-label="Open claim #12"'));
    assert.equal(html.split('href="/claims/c1"').length, 2);
    assert.ok(html.includes('>#12<') && html.includes('Patient #3'));
    assert.ok(html.includes('Doe, Jane') && html.includes('PCR-1001'));
    assert.ok(html.includes('$1,142.20') && html.includes('$300.00'));
    assert.ok(html.includes('Medicare → Blue Plan') && html.includes('Patient only'));
    assert.ok(html.includes('>Submitted<'));
    const own = renderToStaticMarkup(
      createElement(ClaimsTable, { claims: [claim], showPatient: false })
    );
    assert.ok(!own.includes('Doe, Jane'));
  });

  it('shows the task each claim is waiting on and links straight to it', () => {
    const waiting = {
      ...claim,
      status: 'draft',
      patient_number: null,
      first_name: null,
      last_name: null,
      task_id: 't1',
      task_title: 'Confirm patient',
      task_queue: 'billing-patients',
      task_kind: 'task',
      task_assignee_email: 'me@example.com',
      open_tasks: 2
    } as const;
    const html = renderToStaticMarkup(
      createElement(ClaimsTable, {
        claims: [waiting, { ...waiting, id: 'c2', task_kind: 'fault', task_assignee_email: null }],
        me: 'me@example.com',
        back: '/claims?task=any'
      })
    );
    assert.ok(html.includes('Not matched yet'));
    assert.ok(html.includes('Confirm patient') && html.includes('+1 more'));
    assert.ok(
      html.includes('Patient Matching · You') && html.includes('Patient Matching · Unassigned')
    );
    assert.ok(
      html.includes(
        'href="/tasks/t1?back=%2Fclaims%3Ftask%3Dany" aria-label="Work Confirm patient on claim #12"'
      )
    );
    assert.ok(html.includes('text-danger font-medium'));
    assert.ok(html.includes('>Draft<'));
  });

  it('numbers claims and patients with a #', () => {
    assert.equal(claimNumber(7), '#7');
  });

  it('names the assignee from the signed in user point of view', () => {
    assert.equal(assigneeOf('me@example.com', 'me@example.com'), 'You');
    assert.equal(assigneeOf('sam@example.com', 'me@example.com'), 'sam@example.com');
    assert.equal(assigneeOf(null, 'me@example.com'), 'Unassigned');
  });
});

describe('ClaimsPage', () => {
  const pending = () => new Promise(() => undefined);
  const noSearch = { firstName: '', lastName: '', birthDate: '', number: '' };
  const render = (tab: 'queue' | 'search', search = noSearch) =>
    renderToStaticMarkup(
      createElement(ClaimsPage, {
        client: { list: pending } as unknown as ClaimsClient,
        live: idleLive,
        me: 'me@example.com',
        tab,
        search
      })
    );

  it('opens on the work queue, with no search form', () => {
    const html = render('queue');
    assert.ok(html.includes('aria-label="Claim views"'));
    assert.ok(html.includes('href="/claims" aria-current="page"'));
    assert.ok(html.includes('href="/claims?tab=search"'));
    assert.ok(!html.includes('aria-label="Search claims"'));
  });

  it('searches every claim by name, birth date or number, asking for a search first', () => {
    assert.deepEqual(
      CLAIM_SEARCH_FIELDS.map((f) => f.name),
      ['firstName', 'lastName', 'birthDate', 'number']
    );
    const empty = render('search');
    assert.ok(empty.includes('href="/claims?tab=search" aria-current="page"'));
    assert.ok(empty.includes('aria-label="Search claims"'));
    assert.ok(empty.includes('for="search-number"') && empty.includes('for="search-birthDate"'));
    assert.ok(empty.includes('Search All Claims'));
    assert.ok(!empty.includes('<select'));
    const searching = render('search', { ...noSearch, lastName: 'doe' });
    assert.ok(!searching.includes('Search All Claims'));
  });
});
