import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ManualPayment } from '@ugula/billing';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunQueueClient } from '@ugula/run-queue';
import type { CompiledQuery } from 'kysely';
import { createClaimTaskStore, documentKey, uploadsOf } from './claim-tasks.ts';

const ID = '0195f2a4-0000-7000-8000-000000000001';

const USER = '0195f2a4-0000-7000-8000-0000000000a1';

const boss: RunQueueClient = { insert: async () => undefined };

const PDF = new TextEncoder().encode('%PDF-1.7 claim');

type Setup = { status?: string; kept?: boolean; coverages?: { id: string; payer: string }[] };

const setup = ({ status = 'submitted', kept = false, coverages = [] }: Setup = {}) => {
  const { db, queries } = createRecordingDb((q: CompiledQuery) => {
    if (q.sql.startsWith('select "id", "agency_id" from "claims"')) {
      return [{ id: ID, agency_id: 't-1' }];
    }
    if (q.sql.includes('for update')) return [{ id: ID, status, patient_id: null }];
    if (q.sql.includes('from "claim_coverages"')) {
      return coverages.map((c) => ({ ...c, has_events: false }));
    }
    if (q.sql.includes('claim_balances')) return [{ balance_cents: 10_000 }];
    if (q.sql.startsWith('select "id" from "claim_documents"')) return kept ? [{ id: 'd0' }] : [];
    if (q.sql.startsWith('insert into "claim_documents"')) return [{ id: 'd1' }];
    if (q.sql.startsWith('insert into "claim_events"')) return [{ id: 'e1' }];
    return [];
  });
  const stored: { key: string; contentType: string }[] = [];
  const store = createClaimTaskStore(
    db,
    {
      getBytes: async () => PDF,
      putBytes: async (key, bytes, contentType) => {
        stored.push({ key, contentType });
        return { bucket: 'b', key, size: bytes.byteLength, contentType };
      }
    },
    boss
  );
  return { queries, stored, store };
};

const payment: ManualPayment = {
  kind: 'response',
  coverageId: null,
  paidCents: 2_500,
  adjustedCents: 0,
  paidOn: null,
  checkNumber: null,
  payerClaimNumber: null,
  adjustments: [],
  note: ''
};

const upload = { bucket: 'b', key: `${uploadsOf('t-1')}u1/pcs form.pdf` };

describe('createClaimTaskStore', () => {
  it('sets payers on an open claim and says why it refuses a draft', async () => {
    const open = setup({ coverages: [{ id: 'm', payer: 'Medicare' }] });
    assert.deepEqual(await open.store.setPayers('r1', ID, ['Medicare', 'Aetna']), {
      status: 'saved'
    });
    assert.ok(open.queries.some((q) => q.sql.startsWith('insert into "claim_coverages"')));
    const draft = await setup({ status: 'draft' }).store.setPayers('r1', ID, []);
    assert.equal(draft.status, 'refused');
  });

  it('posts a payment keyed by the run step, by the biller who entered it', async () => {
    const { queries, store } = setup();
    assert.deepEqual(await store.postPayment('r1', ID, 'run:step', payment, USER), {
      status: 'posted',
      balanceCents: 7_500
    });
    const [event] = queries.filter((q) => q.sql.startsWith('insert into "claim_events"'));
    assert.ok(event?.parameters.includes('run:step') && event.parameters.includes(USER));
    const closed = await setup({ status: 'paid' }).store.postPayment('r1', ID, 'k', payment, 'x');
    assert.deepEqual(closed, { status: 'refused', reason: 'Claim is already closed' });
  });

  it('keeps an upload as a claim document, typed by its content, once per step', async () => {
    const { queries, stored, store } = setup();
    const added = await store.addDocument('r1', ID, 'run:step', {
      kind: 'pcs',
      signedOn: '2026-09-30',
      file: upload,
      addedBy: USER
    });
    assert.deepEqual(added, { status: 'added', documentId: 'd1' });
    assert.deepEqual(stored, [
      { key: documentKey('t-1', ID, 'run:step', 'pcs form.pdf'), contentType: 'application/pdf' }
    ]);
    const [event] = queries.filter((q) => q.sql.startsWith('insert into "claim_events"'));
    assert.ok(
      event?.parameters.includes('Physician certification statement uploaded: pcs form.pdf')
    );
    const again = setup({ kept: true });
    assert.deepEqual(
      await again.store.addDocument('r1', ID, 'run:step', {
        kind: 'pcs',
        signedOn: null,
        file: upload,
        addedBy: null
      }),
      { status: 'added', documentId: 'd0' }
    );
    assert.ok(!again.queries.some((q) => q.sql.startsWith('insert into "claim_documents"')));
  });

  it('refuses closed claims and files that are not documents, and rejects other uploads', async () => {
    const document = { kind: 'abn' as const, signedOn: null, file: upload, addedBy: null };
    assert.deepEqual(await setup({ status: 'void' }).store.addDocument('r1', ID, 'k', document), {
      status: 'refused',
      reason: 'Claim is already closed'
    });
    const html = setup();
    const store = createClaimTaskStore(
      createRecordingDb((q) =>
        q.sql.startsWith('select "id", "agency_id"') ? [{ id: ID, agency_id: 't-1' }] : []
      ).db,
      {
        getBytes: async () => new TextEncoder().encode('<html>'),
        putBytes: async () => {
          throw new Error('not stored');
        }
      },
      boss
    );
    assert.equal((await store.addDocument('r1', ID, 'k', document)).status, 'refused');
    await assert.rejects(
      () =>
        html.store.addDocument('r1', ID, 'k', {
          ...document,
          file: { bucket: 'b', key: 'imports/t-2/uploads/u1/x.pdf' }
        }),
      /not one of this agency's uploads/
    );
  });
});
