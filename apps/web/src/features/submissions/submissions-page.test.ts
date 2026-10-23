import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PendingClaim } from './client.ts';
import { BatchesTable, PendingTable, selectedIds } from './submissions-page.tsx';

const ready: PendingClaim = {
  id: 'c1',
  pcrNumber: 'PCR-1',
  patient: 'Jane Doe',
  serviceDate: '2026-10-01',
  payer: 'Medicare',
  totalCents: 92_300,
  resubmission: false,
  issues: []
};

const blocked: PendingClaim = {
  ...ready,
  id: 'c2',
  patient: 'John Roe',
  resubmission: true,
  issues: ['The member ID for Medicare is missing']
};

describe('submissions page', () => {
  it('selects every ready claim unless the biller leaves it out', () => {
    assert.deepEqual(selectedIds([ready, blocked], new Set()), ['c1']);
    assert.deepEqual(selectedIds([ready, blocked], new Set(['c1'])), []);
  });

  it('shows readiness, blockers and resubmissions for each pending claim', () => {
    const html = renderToStaticMarkup(
      createElement(PendingTable, {
        claims: [ready, blocked],
        excluded: new Set<string>(),
        onToggle: () => undefined,
        onMarkSubmitted: () => undefined
      })
    );
    assert.ok(html.includes('aria-label="Include Jane Doe in the batch"'));
    assert.ok(html.includes('>Ready<'));
    assert.ok(html.includes('The member ID for Medicare is missing'));
    assert.ok(html.includes('>Resubmission<'));
    assert.ok(html.includes('href="/claims/c2"'));
    assert.equal(html.match(/disabled=""/g)?.length, 1);
    assert.ok(html.includes('$923.00'));
  });

  it('lists batches with their usage and a download link', () => {
    const html = renderToStaticMarkup(
      createElement(BatchesTable, {
        batches: [
          {
            id: 'b1',
            control_number: 7,
            claim_count: 2,
            total_cents: 150_000,
            production: false,
            created_at: '2026-10-23T12:00:00.000Z',
            created_by_email: 'dev@example.com'
          }
        ],
        fileUrl: (id) => `http://api.test/api/submissions/batches/${id}/file`
      })
    );
    assert.ok(html.includes('#7'));
    assert.ok(html.includes('>Test<'));
    assert.ok(html.includes('href="http://api.test/api/submissions/batches/b1/file"'));
    assert.ok(html.includes('dev@example.com'));
  });
});
