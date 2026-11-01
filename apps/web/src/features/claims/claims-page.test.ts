import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import { tableStateOf } from '../../shared/url-state.ts';
import {
  ClaimsPage,
  ClaimsTable,
  matchesSearch,
  READY_TABLE,
  ReadyTable,
  selectedIds
} from './claims-page.tsx';
import type { ClaimSummary, ClaimsClient, PendingClaim } from './client.ts';
import { FilesTable } from './files-page.tsx';

const claim: ClaimSummary = {
  id: 'c1',
  pcr_number: 'PCR-1001',
  level: 'ALS1',
  total_cents: 114_220,
  balance_cents: 30_000,
  service_date: '2026-10-01',
  payers: ['Medicare', 'Blue Plan'],
  status: 'open',
  created_at: '2026-10-01T00:00:00Z',
  first_name: 'Jane',
  last_name: 'Doe'
};

const ready: PendingClaim = {
  id: 'c1',
  pcrNumber: 'PCR-1',
  patient: 'Jane Doe',
  serviceDate: '2026-10-01',
  payer: 'Medicare',
  totalCents: 95_000,
  resubmission: false,
  issues: []
};

const blocked: PendingClaim = {
  ...ready,
  id: 'c2',
  patient: 'John Roe',
  pcrNumber: 'PCR-2',
  resubmission: true,
  issues: ['Add the member ID']
};

describe('ClaimsTable', () => {
  it('links each claim and shows money, payer order and status', () => {
    const html = renderToStaticMarkup(
      createElement(ClaimsTable, { claims: [claim, { ...claim, id: 'c2', payers: [] }] })
    );
    assert.ok(html.includes('href="/claims/c1"'));
    assert.ok(html.includes('Doe, Jane'));
    assert.ok(html.includes('$1,142.20'));
    assert.ok(html.includes('$300.00'));
    assert.ok(html.includes('Medicare → Blue Plan'));
    assert.ok(html.includes('Patient only'));
    assert.ok(html.includes('>Open<'));
  });
});

describe('ReadyTable', () => {
  it('checks ready claims and lists what blocks the rest', () => {
    const html = renderToStaticMarkup(
      createElement(ReadyTable, {
        claims: [ready, blocked],
        excluded: new Set<string>(),
        sorting: tableStateOf('/claims', new URLSearchParams('view=ready'), READY_TABLE),
        onToggle: () => undefined
      })
    );
    assert.equal(html.match(/checked=""/g)?.length, 1);
    assert.equal(html.match(/disabled=""/g)?.length, 1);
    assert.ok(html.includes('Add the member ID') && html.includes('Resubmission'));
    assert.ok(html.includes('>Ready<'));
  });

  it('selects ready claims that were not unchecked and searches by patient or PCR', () => {
    assert.deepEqual(selectedIds([ready, blocked], new Set()), ['c1']);
    assert.deepEqual(selectedIds([ready], new Set(['c1'])), []);
    assert.equal(matchesSearch(ready, 'doe, jane'), true);
    assert.equal(matchesSearch(ready, 'pcr-1'), true);
    assert.equal(matchesSearch(ready, 'roe'), false);
    assert.equal(matchesSearch(ready, ''), true);
  });
});

describe('FilesTable', () => {
  it('lists 837P files with their usage and a download', () => {
    const html = renderToStaticMarkup(
      createElement(FilesTable, {
        batches: [
          {
            id: 'b1',
            control_number: 7,
            claim_count: 2,
            total_cents: 190_000,
            production: false,
            created_at: '2026-10-01T00:00:00Z',
            created_by_email: null
          }
        ],
        fileUrl: (id) => `/files/${id}`
      })
    );
    assert.ok(html.includes('#7') && html.includes('Test') && html.includes('$1,900.00'));
    assert.ok(html.includes('href="/files/b1"') && html.includes('Download #7'));
  });
});

describe('ClaimsPage', () => {
  it('offers the ready-to-submit view, search and 837P files', () => {
    const pending = () => new Promise(() => undefined);
    const html = renderToStaticMarkup(
      createElement(ClaimsPage, {
        client: { pending, list: pending } as unknown as ClaimsClient,
        live: idleLive,
        view: 'open',
        q: ''
      })
    );
    assert.ok(html.includes('href="/claims?view=ready"'));
    assert.ok(html.includes('href="/claims/files"'));
    assert.ok(html.includes('<search'));
  });
});
