import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PAYER_FILE_LABELS } from '@ugula/billing';
import { createElement } from 'react';
import type { ClaimDetail, ClaimPayerFile } from '../../shared/claims/claim-detail.ts';
import { formatDateTime } from '../../shared/format.ts';
import { render, screen, within } from '../../shared/testing-dom.ts';
import { ClaimFiles } from './claim-files.tsx';
import type { ClaimEvent } from './client.ts';

type Source = Pick<
  ClaimDetail,
  'import_report_id' | 'pcr_number' | 'import_id' | 'import_file_name'
>;

const imported: Source = {
  import_report_id: 'r1',
  pcr_number: 'PCR-1',
  import_id: 'i1',
  import_file_name: 'october.xml'
};

const noSource: Source = {
  import_report_id: null,
  pcr_number: null,
  import_id: null,
  import_file_name: null
};

const event: ClaimEvent = {
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
};

const ack: ClaimPayerFile = {
  id: 'pf1',
  kind: '999',
  file_name: 'ack.999',
  created_at: '2026-10-03T00:00:00Z',
  items: [
    { outcome: 'rejected', message: 'Invalid member ID' },
    { outcome: 'accepted', message: '' }
  ]
};

const show = ({
  claim = imported,
  files = [],
  payerFiles = []
}: {
  claim?: Source;
  files?: ClaimEvent[];
  payerFiles?: ClaimPayerFile[];
}) => {
  render(
    createElement(ClaimFiles, {
      claim,
      files,
      payerFiles,
      back: '/claims/c1',
      documentUrl: (id) => `/docs/${id}`,
      fileUrl: (id) => `/files/${id}`,
      encounterUrl: (id) => `/encounters/${id}`
    })
  );
  return within(screen.getByRole('region', { name: 'Files' }));
};

const itemTexts = (panel: ReturnType<typeof show>) =>
  panel.getAllByRole('listitem').map((li) => li.textContent);

describe('ClaimFiles', () => {
  it('downloads the source encounter and opens the import it came from', () => {
    const panel = show({});
    assert.deepEqual(itemTexts(panel), ['Encounter PCR-1 (NEMSIS XML)from october.xml']);
    const encounter = panel.getByRole('link', { name: 'Encounter PCR-1 (NEMSIS XML)' });
    assert.equal(encounter.getAttribute('href'), '/encounters/r1');
    assert.equal(encounter.hasAttribute('download'), true);
    assert.equal(
      panel.getByRole('link', { name: 'october.xml' }).getAttribute('href'),
      '/imports/i1?back=%2Fclaims%2Fc1'
    );
  });

  it('downloads an encounter whose import is gone without linking the import', () => {
    const panel = show({ claim: { ...imported, pcr_number: null, import_id: null } });
    assert.deepEqual(
      panel.getAllByRole('link').map((a) => a.textContent),
      ['Encounter (NEMSIS XML)']
    );
  });

  it('says when the claim has no source encounter file', () => {
    const panel = show({ claim: noSource });
    assert.deepEqual(itemTexts(panel), ['No source encounter file.']);
    assert.equal(panel.queryByRole('link'), null);
  });

  it('downloads each 837P file with its payer and when it was sent', () => {
    const panel = show({ claim: noSource, files: [event] });
    assert.deepEqual(itemTexts(panel).slice(1), [
      `837P File #7Medicare · ${formatDateTime(event.created_at)}Sent ${formatDateTime('2026-10-02T00:01:00Z')}`
    ]);
    const file = panel.getByRole('link', { name: '837P File #7' });
    assert.equal(file.getAttribute('href'), '/files/b7');
    assert.equal(file.hasAttribute('download'), true);
  });

  it('warns that an 837P file not yet sent must be uploaded to the clearinghouse', () => {
    const panel = show({ claim: noSource, files: [{ ...event, batch_sent_at: null }] });
    assert.ok(panel.getByText('Not sent; upload it to the clearinghouse'));
  });

  it('opens each payer file with the outcome of each of its lines', () => {
    const panel = show({ claim: noSource, payerFiles: [ack] });
    assert.deepEqual(itemTexts(panel).slice(1), [
      `ack.999${PAYER_FILE_LABELS['999']} · ${formatDateTime(ack.created_at)}RejectedInvalid member IDAccepted`
    ]);
    assert.equal(
      panel.getByRole('link', { name: 'ack.999' }).getAttribute('href'),
      '/payer-files/pf1?back=%2Fclaims%2Fc1'
    );
  });

  it('opens each document an event came with, named by its note or else its kind', () => {
    const panel = show({
      claim: noSource,
      files: [
        {
          ...event,
          id: 'e2',
          kind: 'statement',
          note: 'Statement 1 of 3',
          batch_id: null,
          has_document: true
        },
        { ...event, id: 'e3', kind: 'denied', note: '', batch_id: null, has_document: true },
        { ...event, id: 'e4', kind: 'response', batch_id: null, has_document: false }
      ]
    });
    const links = panel.getAllByRole('link');
    assert.deepEqual(
      links.map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('target')]),
      [
        ['Statement 1 of 3', '/docs/e2', '_blank'],
        ['Denied', '/docs/e3', '_blank']
      ]
    );
  });

  it('lists the encounter, then 837P files, payer files and documents', () => {
    const panel = show({
      files: [{ ...event, id: 'e2', note: 'PDF', batch_id: null, has_document: true }, event],
      payerFiles: [ack]
    });
    assert.deepEqual(
      panel.getAllByRole('link').map((a) => a.textContent),
      ['Encounter PCR-1 (NEMSIS XML)', 'october.xml', '837P File #7', 'ack.999', 'PDF']
    );
  });
});
