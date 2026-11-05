import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClaimFiles } from './claim-files.tsx';

describe('ClaimFiles', () => {
  it('lists the encounter, 837P files and documents for the claim', () => {
    const html = renderToStaticMarkup(
      createElement(ClaimFiles, {
        claim: {
          import_report_id: 'r1',
          pcr_number: 'PCR-1',
          import_id: 'i1',
          import_file_name: 'october.xml'
        },
        payerFiles: [
          {
            id: 'pf1',
            kind: '999',
            file_name: 'ack.999',
            created_at: '2026-10-03T00:00:00Z',
            items: [{ outcome: 'rejected', message: 'Invalid member ID' }]
          }
        ],
        back: '/claims/c1',
        files: [
          {
            id: 'e1',
            kind: 'submitted',
            coverage_id: 'cov-m',
            payer: 'Medicare',
            paid_cents: 0,
            adjusted_cents: 0,
            paid_on: null,
            check_number: null,
            payer_claim_number: null,
            note: '837P file #7',
            created_at: '2026-10-02T00:00:00Z',
            has_document: false,
            batch_id: 'b7',
            batch_number: 7,
            batch_sent_at: '2026-10-02T00:01:00Z'
          },
          {
            id: 'e2',
            kind: 'statement',
            coverage_id: null,
            payer: null,
            paid_cents: 0,
            adjusted_cents: 0,
            paid_on: null,
            check_number: null,
            payer_claim_number: null,
            note: 'Patient statement 1 of 3',
            created_at: '2026-10-03T00:00:00Z',
            has_document: true
          }
        ],
        documentUrl: (id) => `/docs/${id}`,
        fileUrl: (id) => `/files/${id}`,
        encounterUrl: (id) => `/encounters/${id}`
      })
    );
    assert.ok(html.includes('href="/encounters/r1"') && html.includes('Encounter PCR-1'));
    assert.ok(html.includes('href="/files/b7"') && html.includes('837P File #7'));
    assert.ok(html.includes('>Sent '));
    assert.ok(html.includes('href="/docs/e2"') && html.includes('Patient statement 1 of 3'));
    assert.ok(
      html.includes('href="/imports/i1?back=%2Fclaims%2Fc1"') && html.includes('october.xml')
    );
    assert.ok(
      html.includes('href="/payer-files/pf1?back=%2Fclaims%2Fc1"') && html.includes('ack.999')
    );
    assert.ok(html.includes('Rejected') && html.includes('Invalid member ID'));
    const bare = renderToStaticMarkup(
      createElement(ClaimFiles, {
        claim: {
          import_report_id: null,
          pcr_number: null,
          import_id: null,
          import_file_name: null
        },
        files: [],
        payerFiles: [],
        back: '/claims',
        documentUrl: () => '',
        fileUrl: () => '',
        encounterUrl: () => ''
      })
    );
    assert.ok(bare.includes('No source encounter file.'));
    const unsent = renderToStaticMarkup(
      createElement(ClaimFiles, {
        claim: {
          import_report_id: 'r1',
          pcr_number: null,
          import_id: null,
          import_file_name: null
        },
        files: [
          {
            id: 'e1',
            kind: 'submitted',
            coverage_id: 'cov-m',
            payer: 'Medicare',
            paid_cents: 0,
            adjusted_cents: 0,
            paid_on: null,
            check_number: null,
            payer_claim_number: null,
            note: '',
            created_at: '2026-10-02T00:00:00Z',
            has_document: false,
            batch_id: 'b8',
            batch_number: 8,
            batch_sent_at: null
          }
        ],
        payerFiles: [],
        back: '/claims',
        documentUrl: () => '',
        fileUrl: (id) => `/files/${id}`,
        encounterUrl: (id) => `/encounters/${id}`
      })
    );
    assert.ok(unsent.includes('Not sent; upload it to the clearinghouse'));
    assert.ok(unsent.includes('href="/encounters/r1"') && !unsent.includes('href="/imports/'));
  });
});
