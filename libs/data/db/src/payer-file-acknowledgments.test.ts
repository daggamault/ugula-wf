import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RunQueueClient } from '@ugula/run-queue';
import {
  postBatchAcknowledgments,
  postClaimAcknowledgments,
  postClaimStatuses,
  postInterchangeAcknowledgments
} from './payer-file-acknowledgments.ts';
import type { Context } from './payer-file-items.ts';
import type { RowsFor } from './testing.ts';
import { createRecordingDb } from './testing.ts';

const boss: RunQueueClient = { insert: async () => undefined };

const contextOf = (rows: RowsFor = () => []) => {
  const { db, queries } = createRecordingDb(rows);
  const c: Context = {
    tx: db,
    boss,
    agencyId: 't1',
    userId: null,
    digest: 'd',
    fileName: 'in.x12',
    now: new Date('2026-11-01T00:00:00Z'),
    postings: []
  };
  return { c, queries };
};

const EVENT_COLUMNS = 8;

const eventRows = (queries: { sql: string; parameters: readonly unknown[] }[]) =>
  queries
    .filter((q) => q.sql.startsWith('insert into "claim_events"'))
    .flatMap((q) =>
      Array.from({ length: q.parameters.length / EVENT_COLUMNS }, (_, i) =>
        q.parameters.slice(i * EVENT_COLUMNS, (i + 1) * EVENT_COLUMNS)
      )
    );

const group = (groupControlNumber: string) => ({
  groupControlNumber,
  accepted: true,
  transactions: [{ controlNumber: '0001', accepted: true, errors: [] }]
});

describe('payer file acknowledgments', () => {
  it('looks a batch up by its control number and reports one it never filed', async () => {
    const none = contextOf();
    const out = await postBatchAcknowledgments(none.c, [group('X')]);
    assert.equal(none.queries.length, 0);
    assert.deepEqual(
      out.items.map((i) => [i.reference, i.outcome]),
      [['X', 'unmatched']]
    );
    const filed = contextOf(({ sql }) =>
      sql.includes('from "claim_batches"')
        ? [{ claim_id: 'c1', coverage_id: 'cov1', number: '20261105-0007' }]
        : []
    );
    const acked = await postBatchAcknowledgments(filed.c, [group('000000101')]);
    const lookup = filed.queries.find((q) => q.sql.includes('from "claim_batches"'));
    assert.ok(lookup?.sql.includes('"b"."control_number" = $2'));
    assert.ok(lookup?.parameters.includes(101));
    assert.deepEqual(
      acked.items.map((i) => [i.reference, i.outcome]),
      [['20261105-0007', 'accepted']]
    );
  });

  it('passes on a TA1 envelope rejection and looks up the batch it names', async () => {
    const { c, queries } = contextOf();
    const out = await postInterchangeAcknowledgments(c, [
      { controlNumber: '000000055', status: 'rejected', noteCode: '006', message: 'Bad ID' }
    ]);
    assert.ok(queries.every((q) => q.sql.startsWith('select')));
    assert.deepEqual(
      out.items.map((i) => [i.reference, i.outcome]),
      [['000000055', 'unmatched']]
    );
    assert.match(out.envelopeRejection ?? '', /rejected the file envelope: interchange 55/);
  });

  it('records a TA1 rejection on each claim of the batch and on the file, not on the batch', async () => {
    const { c, queries } = contextOf(({ sql }) =>
      sql.includes('from "claim_batches" as "b"')
        ? [{ claim_id: 'c1', coverage_id: 'cov1', number: '20261105-0007' }]
        : []
    );
    const out = await postInterchangeAcknowledgments(c, [
      { controlNumber: '000000055', status: 'rejected', noteCode: '', message: 'Bad ID' }
    ]);
    assert.ok(!queries.some((q) => q.sql.startsWith('update')));
    const lookup = queries.find((q) => q.sql.includes('from "claim_batches" as "b"'));
    assert.deepEqual(lookup?.parameters, ['t1', 55, 'submitted', 'resubmitted']);
    const note =
      'The clearinghouse rejected the file envelope of 837P file 55: Bad ID (TA1 note not given)';
    assert.deepEqual(eventRows(queries), [
      ['t1', 'c1', 'rejected', 'cov1', note, null, null, 'd:000000055:c1']
    ]);
    assert.deepEqual(out, {
      items: [
        {
          reference: '20261105-0007',
          claimId: 'c1',
          outcome: 'rejected',
          message: note,
          paidCents: null,
          adjustedCents: null
        }
      ],
      envelopeRejection:
        'The clearinghouse rejected the file envelope: interchange 55: Bad ID (TA1 note not given)'
    });
  });

  it('does not mark a batch for a rejected TA1 whose control number is not a positive number', async () => {
    const { c, queries } = contextOf();
    const out = await postInterchangeAcknowledgments(c, [
      { controlNumber: 'ABC', status: 'rejected', noteCode: '024', message: 'Bad' },
      { controlNumber: '000000000', status: 'rejected', noteCode: '024', message: 'Zero' }
    ]);
    assert.deepEqual(queries, []);
    assert.deepEqual(
      out.items.map((i) => [i.reference, i.outcome, i.message]),
      [
        ['ABC', 'unmatched', 'No 837P file has control number ABC'],
        ['000000000', 'unmatched', 'No 837P file has control number 000000000']
      ]
    );
    assert.equal(
      out.envelopeRejection,
      'The clearinghouse rejected the file envelope: interchange ABC: Bad (TA1 note 024); interchange 000000000: Zero (TA1 note 024)'
    );
  });

  it('lists accepted interchanges, with their errors, without touching any batch', async () => {
    const { c, queries } = contextOf();
    const out = await postInterchangeAcknowledgments(c, [
      { controlNumber: '000000101', status: 'accepted', noteCode: '000', message: '' },
      {
        controlNumber: '000000102',
        status: 'acceptedWithErrors',
        noteCode: '020',
        message: 'Invalid test indicator'
      }
    ]);
    assert.deepEqual(queries, []);
    assert.deepEqual(out, {
      items: [
        {
          reference: '101',
          claimId: null,
          outcome: 'accepted',
          message: 'The clearinghouse accepted interchange 101',
          paidCents: null,
          adjustedCents: null
        },
        {
          reference: '102',
          claimId: null,
          outcome: 'accepted',
          message: 'The clearinghouse accepted interchange 102 with errors: Invalid test indicator',
          paidCents: null,
          adjustedCents: null
        }
      ],
      envelopeRejection: null
    });
  });

  it('rejects a 999 batch with its errors and skips claims filed without a coverage', async () => {
    const { c, queries } = contextOf(({ sql }) =>
      sql.includes('from "claim_batches" as "b"')
        ? [
            { claim_id: 'c1', coverage_id: 'cov1', number: '20261105-0007' },
            { claim_id: 'c2', coverage_id: null, number: '20261105-0008' }
          ]
        : []
    );
    const out = await postBatchAcknowledgments(c, [
      {
        groupControlNumber: '7',
        accepted: true,
        transactions: [
          { controlNumber: '0001', accepted: false, errors: ['Bad NM1', 'Bad DTP'] },
          { controlNumber: '0002', accepted: true, errors: [] }
        ]
      },
      { groupControlNumber: '8', accepted: false, transactions: [] }
    ]);
    const lookups = queries.filter((q) => q.sql.includes('from "claim_batches" as "b"'));
    assert.deepEqual(
      lookups.map((q) => q.parameters),
      [
        ['t1', 7, 'submitted', 'resubmitted'],
        ['t1', 8, 'submitted', 'resubmitted']
      ]
    );
    assert.deepEqual(
      out.items.map((i) => [i.claimId, i.outcome, i.message]),
      [
        ['c1', 'rejected', 'The clearinghouse rejected 837P file 7: Bad NM1; Bad DTP'],
        ['c1', 'rejected', 'The clearinghouse rejected 837P file 8']
      ]
    );
    assert.equal(queries.filter((q) => q.sql.startsWith('insert into "claim_events"')).length, 1);
    assert.deepEqual(
      eventRows(queries).map((p) => [p[1], p[3], p[7]]),
      [
        ['c1', 'cov1', 'd:7:c1'],
        ['c1', 'cov1', 'd:8:c1']
      ]
    );
  });

  it('posts 277CA acknowledgments against the coverage last submitted', async () => {
    const claims: Record<string, string> = { '20261105-1001': 'c1', '20261105-1002': 'c2' };
    const { c, queries } = contextOf(({ sql, parameters }) => {
      if (sql.startsWith('select "id", "number", "status" from "claims"')) {
        return parameters.flatMap((n) => {
          const id = claims[String(n)];
          return id ? [{ id, number: n, status: 'submitted' }] : [];
        });
      }
      if (sql.includes('"claim_id", "coverage_id" from "claim_events"')) {
        return parameters.includes('c1') ? [{ claim_id: 'c1', coverage_id: 'cov1' }] : [];
      }
      return [];
    });
    const ack = (
      claimNumber: string,
      status: 'accepted' | 'rejected' | 'pending',
      message = ''
    ) => ({
      claimNumber,
      status,
      categories: status === 'rejected' ? ['A7', 'A8'] : ['A1'],
      payerClaimNumber: status === 'accepted' ? 'PCN-1' : null,
      message
    });
    const out = await postClaimAcknowledgments(c, [
      ack('20261105-1001', 'accepted'),
      ack('20261105-1001', 'rejected', 'Missing NPI'),
      ack('20261105-1001', 'pending', 'Waiting on payer'),
      ack('20261105-1001', 'pending'),
      ack('20261105-1002', 'accepted'),
      ack('20261105-9999', 'accepted'),
      ack('not a number', 'accepted')
    ]);
    assert.deepEqual(
      out.items.map((i) => [i.reference, i.claimId, i.outcome, i.message]),
      [
        ['20261105-1001', 'c1', 'accepted', 'Accepted (A1)'],
        ['20261105-1001', 'c1', 'rejected', 'Rejected (A7, A8): Missing NPI'],
        ['20261105-1001', 'c1', 'review', 'Pending: Waiting on payer'],
        ['20261105-1001', 'c1', 'review', 'Pending: A1'],
        ['20261105-1002', 'c2', 'review', 'The claim has not been submitted from here'],
        ['20261105-9999', null, 'unmatched', 'No claim has number 20261105-9999'],
        ['not a number', null, 'unmatched', 'No claim has number not a number']
      ]
    );
    assert.equal(out.envelopeRejection, null);
    assert.deepEqual(
      queries.filter((q) => q.sql.includes('from "claims"')).map((q) => q.parameters),
      [['t1', '20261105-1001', '20261105-1002', '20261105-9999']]
    );
    assert.deepEqual(
      queries.filter((q) => q.sql.includes('from "claim_events"')).map((q) => q.parameters),
      [['c1', 'c2', 'submitted', 'resubmitted']]
    );
    assert.equal(queries.filter((q) => q.sql.startsWith('insert into "claim_events"')).length, 1);
    assert.deepEqual(eventRows(queries), [
      ['t1', 'c1', 'accepted', 'cov1', 'Accepted (A1)', 'PCN-1', null, 'd:1'],
      ['t1', 'c1', 'rejected', 'cov1', 'Rejected (A7, A8): Missing NPI', null, null, 'd:2']
    ]);
  });

  it('sends a claim status for a claim never submitted from here to a biller', async () => {
    const { c } = contextOf(({ sql }) =>
      sql.startsWith('select "id", "number", "status" from "claims"')
        ? [{ id: 'c1', number: '20261105-1001', status: 'paid' }]
        : []
    );
    const out = await postClaimStatuses(c, [
      {
        trace: '20261105-1001',
        claimNumber: '20261105-1001',
        category: 'A2',
        code: '20',
        meaning: 'inProcess',
        message: '',
        payerClaimNumber: null,
        chargeCents: 100,
        paidCents: 0
      }
    ]);
    assert.deepEqual(
      out.items.map((i) => [i.claimId, i.outcome, i.message]),
      [['c1', 'review', 'The claim has not been submitted from here']]
    );
  });
});
