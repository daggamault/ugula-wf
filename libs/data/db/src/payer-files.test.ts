import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import type { RemittancePosting } from '@ugula/billing';
import { build271, build277, build277Status, build835, build999 } from '@ugula/billing/mock';
import { buildTA1 } from '@ugula/billing/mock-waystar';
import type { RunQueueClient } from '@ugula/run-queue';
import type { FileItem } from './payer-file-items.ts';
import { applyPayerFile, readPayerFile, readRemittanceLines } from './payer-files.ts';
import { createRecordingDb } from './testing.ts';

const createdAt = new Date('2026-10-31T09:00:00Z');

const TRACE = '0195f2a4-0000-7000-8000-0000000000c1';

const bytes = (text: string) => new TextEncoder().encode(text);

const boss: RunQueueClient = { insert: async () => undefined };

const fileDb = () =>
  createRecordingDb(({ sql, parameters }) => {
    if (sql.startsWith('insert into "payer_files"')) return [{ id: 'f1' }];
    if (sql.startsWith('select "id", "status" from "claims"'))
      return parameters[1] === 1001 ? [{ id: 'c1', status: 'submitted' }] : [];
    if (sql.includes('for update')) return [{ id: 'c1', status: 'submitted', patient_id: 'p1' }];
    if (sql.includes('from "claim_coverages" as "cc"'))
      return [{ id: 'cov1', payerId: 'DEMOMCR', payer: 'Medicare', has_events: true }];
    if (sql.includes('claim_balances')) return [{ balance_cents: 100_000 }];
    if (sql.startsWith('insert into "claim_events"')) return [{ id: 'e1' }];
    if (sql.startsWith('select "coverage_id" from "claim_events"'))
      return [{ coverage_id: 'cov1' }];
    if (sql.includes('from "claim_batches"'))
      return parameters.includes(55)
        ? [
            { claim_id: 'c1', coverage_id: 'cov1', number: 1001 },
            { claim_id: 'c2', coverage_id: null, number: 1002 }
          ]
        : [];
    if (sql.includes('"claim_coverages"."id" = $'))
      return parameters.includes(TRACE) ? [{ id: 'cov1', claim_id: 'c1' }] : [];
    return [];
  });

const apply = async (text: string, postings: RemittancePosting[] = []) => {
  const read = readPayerFile(bytes(text));
  assert.ok(read.ok);
  const { db, queries } = fileDb();
  const out = await applyPayerFile(db, boss, {
    agencyId: 't1',
    userId: 'u1',
    fileName: 'in.x12',
    document: { key: 'k' },
    file: read.value,
    now: createdAt,
    postings
  });
  const events = queries.filter((q) => q.sql.startsWith('insert into "claim_events"'));
  return { out, queries, events, digest: read.value.digest };
};

const outcomes = (items: readonly FileItem[]) =>
  items.map((i) => [i.reference, i.claimId, i.outcome, i.message]);

describe('readPayerFile', () => {
  it('reads the kind and digest of an X12 file', () => {
    const text = build271({ trace: TRACE, active: true }, { createdAt });
    const read = readPayerFile(bytes(text));
    assert.equal(read.ok && read.value.kind, '271');
    assert.equal(read.ok && read.value.text, text);
    assert.equal(read.ok && read.value.digest, createHash('sha256').update(text).digest('hex'));
  });

  it('refuses empty files and files that are not payer files', () => {
    assert.deepEqual(readPayerFile(new Uint8Array()), {
      ok: false,
      failure: { code: 'invalid', message: 'The file is empty' }
    });
    const garbage = readPayerFile(bytes('hello'));
    assert.match(garbage.ok ? '' : garbage.failure.message, /is not a remittance \(835\)/);
  });
});

describe('applyPayerFile', () => {
  it('posts remittances to matched claims and leaves unknown claims unmatched', async () => {
    const { out, queries, events, digest } = await apply(
      build835(
        [
          {
            checkNumber: 'CHK-1',
            claims: [
              {
                claimNumber: '1001',
                chargeCents: 100_000,
                paidCents: 60_000,
                payerClaimNumber: 'ICN-1'
              },
              { claimNumber: '2002', chargeCents: 1_000, paidCents: 500 }
            ]
          }
        ],
        { createdAt }
      ),
      [
        { position: 1, route: 'reconcile', message: '', adjustedCents: 40_000 },
        { position: 2, route: 'unmatched', message: 'No claim has number 2002', adjustedCents: 0 }
      ]
    );
    assert.deepEqual(outcomes(out.items), [
      ['1001', 'c1', 'posted', ''],
      ['2002', null, 'unmatched', 'No claim has number 2002']
    ]);
    assert.deepEqual([out.items[0]?.paidCents, out.items[0]?.adjustedCents], [60_000, 40_000]);
    assert.deepEqual([out.id, out.kind, out.problems], ['f1', '835', 1]);
    assert.equal(events.length, 1);
    for (const value of [`${digest}:1`, 'ICN-1', 'CHK-1', 60_000, 40_000]) {
      assert.ok(events[0]?.parameters.includes(value), String(value));
    }
    assert.deepEqual(queries.at(-1)?.parameters, [2, 1, 'f1']);
  });

  it('reads each 835 claim payment with the claim and payer it matches, posting nothing', async () => {
    const { db, queries } = fileDb();
    const text = build835(
      [
        {
          claims: [
            { claimNumber: '1001', chargeCents: 100_000, paidCents: 60_000 },
            { claimNumber: '2002', chargeCents: 1_000, paidCents: 500 }
          ]
        }
      ],
      { createdAt }
    );
    const lines = await readRemittanceLines(db, 't1', text);
    assert.deepEqual(
      lines.map((l) => [l.position, l.reference, l.claimId, l.coverageId, l.takeback]),
      [
        [1, '1001', 'c1', 'cov1', false],
        [2, '2002', null, null, false]
      ]
    );
    assert.ok(queries.every((q) => q.sql.startsWith('select')));
  });

  it('posts a denial the rules routed to be worked and records the denial with its route', async () => {
    const text = build835(
      [{ claims: [{ claimNumber: '1001', chargeCents: 100_000, paidCents: 0 }] }],
      { createdAt }
    );
    const { out, events, digest } = await apply(text, [
      {
        position: 1,
        route: 'appeal',
        message: 'Medicare denied medical necessity',
        adjustedCents: 0
      }
    ]);
    assert.deepEqual(outcomes(out.items), [['1001', 'c1', 'posted', 'Denied']]);
    assert.equal(events.length, 2);
    for (const value of [
      'denied',
      'appeal',
      'Medicare denied medical necessity',
      `${digest}:1:denied`
    ]) {
      assert.ok(events[1]?.parameters.includes(value), value);
    }
  });

  it('leaves a payment the rules routed to review unposted, and faults without a decision', async () => {
    const text = build835(
      [{ claims: [{ claimNumber: '1001', chargeCents: 100_000, paidCents: 60_000 }] }],
      { createdAt }
    );
    const { out, events } = await apply(text, [
      { position: 1, route: 'review', message: 'Reversed', adjustedCents: 0 }
    ]);
    assert.deepEqual(outcomes(out.items), [['1001', 'c1', 'review', 'Reversed']]);
    assert.equal(events.length, 0);
    await assert.rejects(() => apply(text), /No posting was decided/);
  });

  it('sends a takeback to a biller instead of rolling the whole file back', async () => {
    const text = build835(
      [
        {
          claims: [
            { claimNumber: '1001', chargeCents: 100_000, paidCents: -20_000 },
            { claimNumber: '2002', chargeCents: 1_000, paidCents: 500 }
          ]
        }
      ],
      { createdAt }
    );
    const { out, events } = await apply(text, [
      { position: 1, route: 'reconcile', message: '', adjustedCents: 0 },
      { position: 2, route: 'unmatched', message: '', adjustedCents: 0 }
    ]);
    assert.deepEqual(outcomes(out.items)[0], [
      '1001',
      'c1',
      'review',
      'Negative amounts (reversals and takebacks) need a biller to post them'
    ]);
    assert.equal(events.length, 0);
  });

  it('records the adjustment actually posted when a payment overpays the claim', async () => {
    const text = build835(
      [{ claims: [{ claimNumber: '1001', chargeCents: 100_000, paidCents: 90_000 }] }],
      { createdAt }
    );
    const { out } = await apply(text, [
      { position: 1, route: 'reconcile', message: '', adjustedCents: 40_000 }
    ]);
    assert.deepEqual([out.items[0]?.paidCents, out.items[0]?.adjustedCents], [90_000, 10_000]);
  });

  it('acknowledges every submitted claim in an 837P batch the clearinghouse answered', async () => {
    const { out, events } = await apply(
      build999(
        { groupControlNumber: '55', transactions: [{ controlNumber: '0001', accepted: false }] },
        { createdAt }
      )
    );
    assert.deepEqual(outcomes(out.items), [
      ['1001', 'c1', 'rejected', 'The clearinghouse rejected 837P file 55']
    ]);
    assert.equal(out.problems, 1);
    assert.equal(events.length, 1);
    assert.ok(events[0]?.parameters.includes('rejected'));
    const unknown = await apply(
      build999({ groupControlNumber: '77', transactions: [] }, { createdAt })
    );
    assert.deepEqual(outcomes(unknown.out.items), [
      ['77', null, 'unmatched', 'No 837P file has control number 77']
    ]);
  });

  it('records payer acknowledgments against the coverage last submitted', async () => {
    const { out, events, digest } = await apply(
      build277(
        {
          claims: [
            { claimNumber: '1001', rejection: null, payerClaimNumber: 'PCN-1' },
            { claimNumber: '2002', rejection: 'Invalid member ID' }
          ]
        },
        { createdAt }
      )
    );
    assert.equal(out.items[0]?.outcome, 'accepted');
    assert.match(out.items[0]?.message ?? '', /^Accepted \(/);
    assert.deepEqual(outcomes(out.items.slice(1)), [
      ['2002', null, 'unmatched', 'No claim has number 2002']
    ]);
    for (const value of ['accepted', 'cov1', 'PCN-1', `${digest}:1`]) {
      assert.ok(events[0]?.parameters.includes(value), value);
    }
  });

  it('saves eligibility for traced coverages and nudges their claims', async () => {
    const active = await apply(
      build271({ trace: TRACE.toUpperCase(), active: true }, { createdAt })
    );
    assert.deepEqual(
      active.out.items.map((i) => [i.reference, i.claimId, i.outcome]),
      [[TRACE.toUpperCase(), 'c1', 'eligible']]
    );
    assert.equal(active.out.problems, 0);
    const saved = active.queries.find((q) => q.sql.startsWith('update "claim_coverages"'));
    assert.equal(saved?.parameters[0], 'active');
    assert.ok(saved?.parameters.includes(createdAt));
    assert.ok(active.queries.some((q) => q.sql.startsWith('insert into "signals"')));
    const inactive = await apply(build271({ trace: TRACE, active: false }, { createdAt }));
    assert.equal(inactive.out.items[0]?.outcome, 'ineligible');
    assert.equal(inactive.out.problems, 1);
    const unknown = await apply(
      build271({ trace: '0195f2a4-0000-7000-8000-0000000000c9', active: true }, { createdAt })
    );
    assert.deepEqual(outcomes(unknown.out.items), [
      [
        '0195f2a4-0000-7000-8000-0000000000c9',
        null,
        'unmatched',
        'No payer on a claim matches this response'
      ]
    ]);
  });

  it('logs each eligibility answer on the claim history', async () => {
    const { events } = await apply(build271({ trace: TRACE, active: false }, { createdAt }));
    assert.equal(events.length, 1);
    assert.ok(events[0]?.parameters.includes('eligibility'));
    assert.ok(events[0]?.parameters.includes('cov1'));
    assert.ok(
      events[0]?.parameters.some(
        (p) => typeof p === 'string' && p.startsWith('Coverage not active')
      )
    );
  });

  it('asks a biller to bill the Medicare Advantage plan a Medicare answer names', async () => {
    const { db } = createRecordingDb(({ sql }) =>
      sql.includes('"claim_coverages"."id" = $')
        ? [{ id: 'cov1', claim_id: 'c1', claim_filing: 'MB' }]
        : sql.startsWith('insert into "payer_files"')
          ? [{ id: 'f1' }]
          : []
    );
    const read = readPayerFile(
      bytes(
        build271(
          { trace: TRACE, active: true, advantagePlan: { name: 'SUNSHINE', id: 'H1' } },
          { createdAt }
        )
      )
    );
    assert.ok(read.ok);
    const out = await applyPayerFile(db, boss, {
      agencyId: 't1',
      userId: null,
      fileName: 'a.271',
      document: {},
      file: read.value,
      now: createdAt,
      postings: []
    });
    assert.equal(out.items[0]?.outcome, 'review');
    assert.match(
      out.items[0]?.message ?? '',
      /^Bill the Medicare Advantage plan instead: SUNSHINE/
    );
  });

  it('rejects the 837P batch a TA1 rejects, sending its claims back to review', async () => {
    const ta1 = buildTA1(
      { sender: 'SUB01', receiver: 'X', controlNumber: '55', production: false },
      '008',
      createdAt
    );
    const { out, queries, events } = await apply(ta1);
    assert.equal(out.kind, 'TA1');
    assert.equal(
      out.envelopeRejection,
      'The clearinghouse rejected the file envelope: interchange 55: Invalid interchange receiver ID (TA1 note 008)'
    );
    assert.deepEqual(outcomes(out.items), [
      [
        '1001',
        'c1',
        'rejected',
        'The clearinghouse rejected the file envelope of 837P file 55: Invalid interchange receiver ID (TA1 note 008)'
      ]
    ]);
    const marked = queries.find((q) => q.sql.startsWith('update "claim_batches"'));
    assert.deepEqual(marked?.parameters.slice(0, 1), [createdAt]);
    assert.ok(marked?.parameters.includes(55));
    assert.ok(events[0]?.parameters.includes('rejected'));
    const unknown = await apply(
      buildTA1(
        { sender: 'S', receiver: 'X', controlNumber: '77', production: false },
        '008',
        createdAt
      )
    );
    assert.equal(unknown.out.items[0]?.outcome, 'unmatched');
    assert.ok(unknown.out.envelopeRejection);
  });

  it('logs payer claim status answers on the claim they name', async () => {
    const { out, events } = await apply(
      build277Status([
        { trace: '1001', claimNumber: '1001', category: 'F1', code: '65', payerClaimNumber: 'P9' },
        { trace: '2002', claimNumber: '2002', category: 'A4', code: '35' }
      ])
    );
    assert.equal(out.kind, '277S');
    assert.deepEqual(outcomes(out.items), [
      ['1001', 'c1', 'status', 'Paid (F1:65): Finalized: payment: Claim has been paid'],
      ['2002', null, 'unmatched', 'No claim has number 2002']
    ]);
    assert.equal(out.envelopeRejection, null);
    for (const value of ['claim_status', 'cov1', 'P9']) {
      assert.ok(events[0]?.parameters.includes(value), value);
    }
  });
});
