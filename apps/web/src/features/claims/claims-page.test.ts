import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import { CLAIM_SEARCH_FIELDS, CLAIM_TABLE, ClaimsPage, ClaimsTable } from './claims-page.tsx';
import type { ClaimSummary, ClaimsClient } from './client.ts';

const claim: ClaimSummary = {
  id: 'c1',
  number: '20261001-0012',
  patient_number: '20260915-0003',
  pcr_number: 'PCR-1001',
  encounter_number: '20261001-0007',
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

const noSearch = { firstName: '', lastName: '', birthDate: '', number: '' };

const marked = (text: string) => new RegExp(`<mark class="[^"]+">${text}</mark>`);

describe('ClaimsTable', () => {
  it('opens each claim from an icon action and shows the patient, encounter, money and status', () => {
    const html = renderToStaticMarkup(
      createElement(ClaimsTable, { claims: [claim, { ...claim, id: 'c2', payers: [] }] })
    );
    assert.ok(html.includes('<span class="sr-only">Actions</span>'));
    assert.ok(html.includes('href="/claims/c1" aria-label="Open claim 20261001-0012"'));
    assert.equal(html.split('href="/claims/c1"').length, 2);
    assert.ok(html.includes('>20261001-0012<') && html.includes('Patient 20260915-0003'));
    assert.ok(!html.includes('#'));
    assert.ok(html.includes('Doe, Jane'));
    assert.ok(html.includes('>20261001-0007<') && html.includes('PCR PCR-1001'));
    assert.ok(html.includes('$1,142.20') && html.includes('$300.00'));
    assert.ok(html.includes('Medicare → Blue Plan') && html.includes('Patient only'));
    assert.ok(html.includes('>Submitted<'));
    assert.ok(!html.includes('<mark'));
    const own = renderToStaticMarkup(
      createElement(ClaimsTable, { claims: [claim], showPatient: false })
    );
    assert.ok(!own.includes('Doe, Jane'));
  });

  it('shows a dash for a claim with neither an encounter nor a PCR number', () => {
    const html = renderToStaticMarkup(
      createElement(ClaimsTable, {
        claims: [{ ...claim, encounter_number: null, pcr_number: null }]
      })
    );
    assert.ok(!html.includes('PCR '));
    assert.ok(!html.includes('20261001-0007'));
  });

  it('highlights the claim, patient or encounter number and PCR the search names', () => {
    const render = (number: string) =>
      renderToStaticMarkup(
        createElement(ClaimsTable, {
          claims: [claim],
          search: { ...noSearch, lastName: 'do', number }
        })
      );
    assert.match(render('#202610010012'), marked('20261001-0012'));
    assert.match(render('20260915-0003'), marked('20260915-0003'));
    assert.match(render('202610010007'), marked('20261001-0007'));
    assert.match(render(' PCR-1001 '), marked('PCR-1001'));
    const partial = render('PCR-10');
    assert.ok(!partial.includes('>PCR-10<'));
    assert.match(partial, marked('Do'));
  });

  it('shows the task each claim is waiting on and opens only the claim', () => {
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
      !html.includes('href="/tasks/') && html.includes('aria-label="Open claim 20261001-0012"')
    );
    assert.ok(html.includes('text-danger font-medium'));
    assert.ok(html.includes('>Draft<'));
  });

  it('sorts by the encounter number', () => {
    assert.equal(CLAIM_TABLE.sorts.encounter, 'desc');
  });
});

describe('ClaimsPage', () => {
  const pending = () => new Promise(() => undefined);
  const render = (search = noSearch) =>
    renderToStaticMarkup(
      createElement(ClaimsPage, {
        client: { list: pending } as unknown as ClaimsClient,
        live: idleLive,
        me: 'me@example.com',
        search
      })
    );

  it('searches every claim by name, birth date or number, asking for a search first', () => {
    assert.deepEqual(
      CLAIM_SEARCH_FIELDS.map((f) => f.name),
      ['firstName', 'lastName', 'birthDate', 'number']
    );
    const empty = render();
    assert.ok(!empty.includes('aria-label="Claim views"'));
    assert.ok(!empty.includes('tab=search'));
    assert.ok(empty.includes('aria-label="Search claims"'));
    assert.ok(empty.includes('for="search-number"') && empty.includes('for="search-birthDate"'));
    assert.ok(empty.includes('Enter a name, birth date, or a claim, patient or encounter number.'));
    assert.ok(!empty.includes('aria-haspopup="listbox"'));
    const searching = render({ ...noSearch, lastName: 'doe' });
    assert.ok(searching.includes('aria-label="Search claims"'));
    assert.ok(!searching.includes('Enter a name, birth date'));
  });
});
