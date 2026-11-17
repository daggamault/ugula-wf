import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import type { RemittancePosting } from '@ugula/billing';
import {
  build271,
  build277,
  build277Status,
  build835,
  build999,
  buildTA1
} from '@ugula/billing/testing';
import type { RunQueueClient } from '@ugula/run-queue';
import type { FileItem } from './payer-file-items.ts';
import {
  applyPayerFile,
  findImported,
  findReviewLines,
  paymentOf,
  readPayerFile,
  readRemittanceLines
} from './payer-files.ts';
import { createRecordingDb } from './testing.ts';

const createdAt = new Date('2026-10-31T09:00:00Z');

const TRACE = '0195f2a4-0000-7000-8000-0000000000c1';

const bytes = (text: string) => new TextEncoder().encode(text);

const boss: RunQueueClient = { insert: async () => undefined };

const fileDb = () =>
  createRecordingDb(({ sql, parameters }) => {
    if (sql.startsWith('insert into "payer_files"')) return [{ id: 'f1' }];
    if (sql.startsWith('insert into "events"')) return [{ id: 'ev1' }];
    if (sql.startsWith('select "id", "number", "status" from "claims"'))
      return parameters.includes('20261105-1001')
        ? [{ id: 'c1', number: '20261105-1001', status: 'submitted' }]
        : [];
    if (sql.includes('for update')) return [{ id: 'c1', status: 'submitted', patient_id: 'p1' }];
    if (sql.includes('from "claim_coverages" as "cc"'))
      return [
        { claim_id: 'c1', id: 'cov1', payerId: 'DEMOMCR', payer: 'Medicare', has_events: true },
        { claim_id: 'c1', id: 'cov2', payerId: 'GAP01', payer: 'Medigap', has_events: false }
      ];
    if (sql.includes('from "claim_lines"'))
      return [
        { claim_id: 'c1', position: 1, code: 'A0427', chargeCents: 90_000 },
        { claim_id: 'c1', position: 2, code: 'A0425', chargeCents: 10_000 }
      ];
    if (sql.includes('claim_balances')) return [{ balance_cents: 100_000 }];
    if (sql.startsWith('insert into "claim_events"')) return [{ id: 'e1' }];
    if (sql.includes('"payer_claim_number" = $'))
      return parameters.includes('ICN-1') || parameters.includes('ICN-7')
        ? [{ id: 'e0', claim_id: 'c1' }]
        : [];
    if (sql.includes('sum(adjusted_cents)')) return [{ paid: 60_000, adjusted: 40_000 }];
    if (sql.includes('"payer_claim_number" is not null'))
      return [
        { coverage_id: 'cov1', payer_claim_number: 'ICN-1' },
        { coverage_id: 'cov1', payer_claim_number: 'ICN-7' }
      ];
    if (sql.includes('"coverage_id" from "claim_events"'))
      return [{ claim_id: 'c1', coverage_id: 'cov1' }];
    if (sql.includes('from "claim_batches"'))
      return parameters.includes(55)
        ? [
            { claim_id: 'c1', coverage_id: 'cov1', number: '20261105-1001' },
            { claim_id: 'c2', coverage_id: null, number: '20261105-1002' }
          ]
        : [];
    if (sql.includes('"claim_coverages"."id" in ($'))
      return parameters.includes(TRACE) ? [{ id: TRACE, claim_id: 'c1' }] : [];
    return [];
  });

const apply = async (text: string, postings: RemittancePosting[] = []) => {
  const read = readPayerFile(bytes(text));
  assert.ok(read.ok);
  const { db, queries } = fileDb();
  const out = await applyPayerFile(db, boss, {
    agencyId: 't1',
    userId: 'u1',
    runId: 'r1',
    sourceKey: 'r1:apply',
    fileName: 'in.x12',
    document: { key: 'k' },
    file: read.value,
    now: createdAt,
    postings
  });
  const events = queries.filter((q) => q.sql.startsWith('insert into "claim_events"'));
  return {
    out,
    queries,
    events,
    digest: read.value.digest,
    controlNumber: read.value.controlNumber
  };
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
    assert.deepEqual(readPayerFile(bytes('hello')), {
      ok: false,
      failure: {
        code: 'invalid',
        message:
          'This is not a remittance (835), acknowledgment (TA1, 999 or 277CA), claim status (277) or eligibility (271) file'
      }
    });
  });
});

describe('paymentOf', () => {
  const remittance = {
    payerName: 'MEDICARE',
    payerId: 'MCR',
    checkNumber: 'EFT-1',
    originatorId: '1512345678',
    paymentMethod: 'ACH',
    paidOn: '2026-10-30',
    totalCents: 12_345,
    providerAdjustments: [],
    claims: []
  };

  it('reads the BPR payment and TRN trace of the first 835 transaction', () => {
    assert.deepEqual(paymentOf([remittance, { ...remittance, checkNumber: 'EFT-2' }]), {
      cents: 12_345,
      method: 'ACH',
      paidOn: '2026-10-30',
      traceNumber: 'EFT-1',
      tracePayerId: '1512345678'
    });
  });

  it('drops a payment method 5010 does not define, and reads nothing from no transaction', () => {
    assert.equal(paymentOf([{ ...remittance, paymentMethod: 'XYZ' }])?.method, null);
    assert.equal(paymentOf([]), null);
  });
});

describe('findImported and findReviewLines', () => {
  it('finds a file the agency already imported by its digest', async () => {
    const row = {
      id: 'f1',
      kind: '835',
      run_id: null,
      source_key: null,
      envelope_rejection: null,
      created_at: createdAt
    };
    const { db, queries } = createRecordingDb(() => [row]);
    assert.deepEqual(await findImported(db, 't1', 'abc'), row);
    assert.equal(
      queries[0]?.sql,
      'select "id", "kind", "run_id", "source_key", "envelope_rejection", "created_at" from "payer_files" where "agency_id" = $1 and "digest" = $2'
    );
    assert.deepEqual(queries[0]?.parameters, ['t1', 'abc']);
    assert.equal(await findImported(createRecordingDb().db, 't1', 'abc'), undefined);
  });

  it('lists only the lines of a file a person has to look at, in file order', async () => {
    const lines = [{ reference: '1001', claimId: null, outcome: 'unmatched', message: 'No claim' }];
    const { db, queries } = createRecordingDb(() => lines);
    assert.deepEqual(await findReviewLines(db, 'f1'), lines);
    assert.equal(
      queries[0]?.sql,
      'select "reference", "claim_id" as "claimId", "outcome", "message" from "payer_file_items" where "file_id" = $1 and "outcome" in ($2, $3) order by "position"'
    );
    assert.deepEqual(queries[0]?.parameters, ['f1', 'unmatched', 'review']);
  });
});

describe('applyPayerFile', () => {
  it('records a file with no lines without inserting any', async () => {
    const { out, queries } = await apply(
      build835([{ checkNumber: 'EFT-9', claims: [] }], { createdAt })
    );
    assert.deepEqual(out, {
      id: 'f1',
      kind: '835',
      items: [],
      problems: 0,
      envelopeRejection: null
    });
    assert.deepEqual(
      queries.map((q) => [q.sql.split(' ').slice(0, 3).join(' '), q.parameters.at(-1)]),
      [
        ['insert into "payer_files"', 'r1:apply'],
        ['update "payer_files" set', 'f1'],
        ['insert into "events"', null]
      ]
    );
    assert.deepEqual(queries[1]?.parameters, [
      0,
      0,
      null,
      0,
      'ACH',
      '2026-10-31',
      'EFT-9',
      '1',
      'f1'
    ]);
    assert.deepEqual(queries[2]?.parameters, [
      't1',
      'remittance.file_applied',
      '{"payerFileId":"f1"}',
      null
    ]);
  });

  it('posts remittances to matched claims and leaves unknown claims unmatched', async () => {
    const { out, queries, events, digest, controlNumber } = await apply(
      build835(
        [
          {
            checkNumber: 'CHK-1',
            claims: [
              {
                claimNumber: '20261105-1001',
                chargeCents: 100_000,
                paidCents: 60_000,
                payerClaimNumber: 'ICN-1'
              },
              { claimNumber: '20261105-2002', chargeCents: 1_000, paidCents: 500 }
            ]
          }
        ],
        { createdAt }
      ),
      [
        { position: 1, route: 'reconcile', message: '', adjustedCents: 40_000, crossover: false },
        {
          position: 2,
          route: 'unmatched',
          message: 'No claim has number 20261105-2002',
          adjustedCents: 0,
          crossover: false
        }
      ]
    );
    assert.deepEqual(outcomes(out.items), [
      ['20261105-1001', 'c1', 'posted', ''],
      ['20261105-2002', null, 'unmatched', 'No claim has number 20261105-2002']
    ]);
    assert.deepEqual([out.items[0]?.paidCents, out.items[0]?.adjustedCents], [60_000, 40_000]);
    assert.deepEqual([out.id, out.kind, out.problems], ['f1', '835', 1]);
    assert.deepEqual(
      events.map((e) => e.parameters),
      [
        [
          't1',
          'c1',
          'response',
          'cov1',
          60_000,
          40_000,
          'ICN-1',
          '2026-10-31',
          'CHK-1',
          'Remittance from MEDICARE in in.x12',
          'u1',
          `${digest}:1`
        ]
      ]
    );
    const file = queries.find((q) => q.sql.startsWith('insert into "payer_files"'));
    assert.deepEqual(
      [file?.sql, file?.parameters],
      [
        'insert into "payer_files" ("agency_id", "kind", "file_name", "digest", "document", "control_number", "uploaded_by_id", "run_id", "source_key") values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning "id"',
        ['t1', '835', 'in.x12', digest, '{"key":"k"}', controlNumber, 'u1', 'r1', 'r1:apply']
      ]
    );
    assert.deepEqual(
      queries.slice(-3, -1).map((q) => [q.sql, q.parameters]),
      [
        [
          'insert into "payer_file_items" ("agency_id", "file_id", "position", "reference", "claim_id", "outcome", "message", "paid_cents", "adjusted_cents") values ($1, $2, $3, $4, $5, $6, $7, $8, $9), ($10, $11, $12, $13, $14, $15, $16, $17, $18)',
          [
            't1',
            'f1',
            1,
            '20261105-1001',
            'c1',
            'posted',
            '',
            60_000,
            40_000,
            't1',
            'f1',
            2,
            '20261105-2002',
            null,
            'unmatched',
            'No claim has number 20261105-2002',
            null,
            null
          ]
        ],
        [
          'update "payer_files" set "item_count" = $1, "problem_count" = $2, "envelope_rejection" = $3, "payment_cents" = $4, "payment_method" = $5, "paid_on" = $6, "trace_number" = $7, "trace_payer_id" = $8 where "id" = $9',
          [2, 1, null, 60_500, 'ACH', '2026-10-31', 'CHK-1', '1', 'f1']
        ]
      ]
    );
  });

  it('stores how the payer adjudicated each claim line, matched by its line number', async () => {
    const { queries } = await apply(
      build835(
        [
          {
            claims: [
              {
                claimNumber: '20261105-1001',
                chargeCents: 100_000,
                paidCents: 60_000,
                lines: [
                  { code: 'A0425', chargeCents: 10_000, paidCents: 5_000, lineNumber: '2' },
                  { code: 'A0427', chargeCents: 90_000, paidCents: 55_000 }
                ]
              }
            ]
          }
        ],
        { createdAt }
      ),
      [{ position: 1, route: 'reconcile', message: '', adjustedCents: 40_000, crossover: false }]
    );
    const billed = queries.find((q) => q.sql.includes('from "claim_lines"'));
    assert.deepEqual(billed?.parameters, ['c1']);
    const lines = queries.find((q) => q.sql.startsWith('insert into "claim_event_lines"'));
    assert.deepEqual(
      [lines?.parameters[1], lines?.parameters[2], lines?.parameters[7], lines?.parameters[8]],
      [2, 'A0425', 1, 'A0427']
    );
  });

  it('asks a biller about each provider-level adjustment (PLB), on the claim it references', async () => {
    const text = build835(
      [
        {
          checkNumber: 'CHK-9',
          claims: [{ claimNumber: '20261105-2002', chargeCents: 1_000, paidCents: 0 }],
          providerAdjustments: [
            { reason: 'WO', reference: 'ICN-7', cents: 12_550 },
            { reason: 'L6', cents: -100 }
          ]
        }
      ],
      { createdAt }
    );
    const { out } = await apply(text, [
      { position: 1, route: 'unmatched', message: '', adjustedCents: 0, crossover: false }
    ]);
    assert.deepEqual(
      out.items.slice(1).map((i) => [i.reference, i.claimId, i.outcome]),
      [
        ['PLB WO ICN-7', 'c1', 'review'],
        ['PLB L6 CHK-9', null, 'review']
      ]
    );
    assert.equal(
      out.items[1]?.message,
      'MEDICARE made a provider-level adjustment (PLB WO) of $125.50 on this payment, such as a recoupment of an earlier payment; post it on the claim it belongs to by hand'
    );
  });

  it('posts a reversal of a posted payment before its corrected claim, as a pair', async () => {
    const text = build835(
      [
        {
          claims: [
            {
              claimNumber: '20261105-1001',
              chargeCents: 100_000,
              paidCents: 70_000,
              payerClaimNumber: 'ICN-2'
            },
            {
              claimNumber: '20261105-1001',
              status: '22',
              chargeCents: -100_000,
              paidCents: -60_000,
              payerClaimNumber: 'ICN-1',
              adjustments: [{ group: 'CO', reason: '45', cents: -40_000 }]
            }
          ]
        }
      ],
      { createdAt }
    );
    const lines = await readRemittanceLines(fileDb().db, 't1', text);
    assert.deepEqual(
      lines.map((l) => [l.reversal, l.reversesPosted, l.takeback]),
      [
        [false, false, false],
        [true, true, true]
      ]
    );
    const { out, events } = await apply(text, [
      { position: 1, route: 'reconcile', message: '', adjustedCents: 30_000, crossover: false },
      { position: 2, route: 'reversal', message: '', adjustedCents: -40_000, crossover: false }
    ]);
    assert.deepEqual(outcomes(out.items), [
      ['20261105-1001', 'c1', 'posted', ''],
      ['20261105-1001', 'c1', 'posted', 'Reversed']
    ]);
    assert.deepEqual(
      events.map((e) => e.parameters.slice(4, 6)),
      [
        [-60_000, -40_000],
        [70_000, 30_000]
      ]
    );
  });

  it('marks the next payer contacted when the rules say the payer crossed the claim over', async () => {
    const text = build835(
      [
        {
          claims: [
            {
              claimNumber: '20261105-1001',
              status: '19',
              chargeCents: 100_000,
              paidCents: 60_000,
              remarks: ['MA18'],
              crossover: { name: 'Medigap Plan', id: 'GAP01' }
            }
          ]
        }
      ],
      { createdAt }
    );
    const [line] = await readRemittanceLines(fileDb().db, 't1', text);
    assert.deepEqual(
      [line?.status, line?.remarks, line?.crossoverPayer, line?.coverageId],
      ['19', ['MA18'], 'MEDIGAP PLAN', 'cov1']
    );
    const { events, digest } = await apply(text, [
      { position: 1, route: 'reconcile', message: '', adjustedCents: 40_000, crossover: true }
    ]);
    assert.equal(events.length, 2);
    assert.deepEqual(events[1]?.parameters, [
      't1',
      'c1',
      'crossed_over',
      'cov2',
      'MEDICARE forwarded the claim to MEDIGAP PLAN; wait for its payment before billing it',
      'u1',
      `${digest}:1:crossed_over`
    ]);
    const plain = await apply(text, [
      { position: 1, route: 'reconcile', message: '', adjustedCents: 40_000, crossover: false }
    ]);
    assert.equal(plain.events.length, 1);
  });

  it('leaves a reversal of a payment no response has to a biller', async () => {
    const text = build835(
      [
        {
          claims: [
            {
              claimNumber: '20261105-1001',
              status: '22',
              chargeCents: -100_000,
              paidCents: -60_000,
              payerClaimNumber: 'ICN-UNKNOWN'
            }
          ]
        }
      ],
      { createdAt }
    );
    const [line] = await readRemittanceLines(fileDb().db, 't1', text);
    assert.deepEqual([line?.reversal, line?.reversesPosted], [true, false]);
  });

  it('reads each 835 claim payment with the claim and payer it matches, posting nothing', async () => {
    const { db, queries } = fileDb();
    const text = build835(
      [
        {
          claims: [
            { claimNumber: '20261105-1001', chargeCents: 100_000, paidCents: 60_000 },
            { claimNumber: '20261105-2002', chargeCents: 1_000, paidCents: 500 }
          ]
        }
      ],
      { createdAt }
    );
    const lines = await readRemittanceLines(db, 't1', text);
    assert.deepEqual(
      lines.map((l) => [l.position, l.reference, l.claimId, l.coverageId, l.takeback]),
      [
        [1, '20261105-1001', 'c1', 'cov1', false],
        [2, '20261105-2002', null, null, false]
      ]
    );
    assert.ok(queries.every((q) => q.sql.startsWith('select')));
  });

  it('posts a denial the rules routed to be worked and records the denial with its route', async () => {
    const text = build835(
      [{ claims: [{ claimNumber: '20261105-1001', chargeCents: 100_000, paidCents: 0 }] }],
      { createdAt }
    );
    const { out, events, digest } = await apply(text, [
      {
        position: 1,
        route: 'appeal',
        message: 'Medicare denied medical necessity',
        adjustedCents: 0,
        crossover: false
      }
    ]);
    assert.deepEqual(outcomes(out.items), [['20261105-1001', 'c1', 'posted', 'Denied']]);
    assert.equal(events.length, 2);
    assert.deepEqual(events[1]?.parameters, [
      't1',
      'c1',
      'denied',
      'cov1',
      'appeal',
      'Medicare denied medical necessity',
      'u1',
      `${digest}:1:denied`
    ]);
  });

  it('leaves a payment the rules routed to review unposted, and faults without a decision', async () => {
    const text = build835(
      [{ claims: [{ claimNumber: '20261105-1001', chargeCents: 100_000, paidCents: 60_000 }] }],
      { createdAt }
    );
    const { out, events } = await apply(text, [
      { position: 1, route: 'review', message: 'Reversed', adjustedCents: 0, crossover: false }
    ]);
    assert.deepEqual(outcomes(out.items), [['20261105-1001', 'c1', 'review', 'Reversed']]);
    assert.equal(events.length, 0);
    await assert.rejects(() => apply(text), /No posting was decided/);
  });

  it('sends a takeback to a biller instead of rolling the whole file back', async () => {
    const text = build835(
      [
        {
          claims: [
            { claimNumber: '20261105-1001', chargeCents: 100_000, paidCents: -20_000 },
            { claimNumber: '20261105-2002', chargeCents: 1_000, paidCents: 500 }
          ]
        }
      ],
      { createdAt }
    );
    const { out, events } = await apply(text, [
      { position: 1, route: 'reconcile', message: '', adjustedCents: 0, crossover: false },
      { position: 2, route: 'unmatched', message: '', adjustedCents: 0, crossover: false }
    ]);
    assert.deepEqual(outcomes(out.items)[0], [
      '20261105-1001',
      'c1',
      'review',
      'Negative amounts (reversals and takebacks) need a biller to post them'
    ]);
    assert.equal(events.length, 0);
  });

  it('sends adjustments that take off more than the payment leaves open to a biller', async () => {
    const text = build835(
      [{ claims: [{ claimNumber: '20261105-1001', chargeCents: 100_000, paidCents: 90_000 }] }],
      { createdAt }
    );
    const { out, events } = await apply(text, [
      { position: 1, route: 'reconcile', message: '', adjustedCents: 40_000, crossover: false }
    ]);
    assert.deepEqual(outcomes(out.items), [
      [
        '20261105-1001',
        'c1',
        'review',
        'The adjustments of $400.00 take off more than the $100.00 left open after the payment; post it by hand'
      ]
    ]);
    assert.equal(events.length, 0);
  });

  it('acknowledges every submitted claim in an 837P batch the clearinghouse answered', async () => {
    const { out, events, digest } = await apply(
      build999(
        { groupControlNumber: '55', transactions: [{ controlNumber: '0001', accepted: false }] },
        { createdAt }
      )
    );
    assert.deepEqual(outcomes(out.items), [
      ['20261105-1001', 'c1', 'rejected', 'The clearinghouse rejected 837P file 55']
    ]);
    assert.equal(out.problems, 1);
    assert.deepEqual(
      events.map((e) => e.parameters),
      [
        [
          't1',
          'c1',
          'rejected',
          'cov1',
          'The clearinghouse rejected 837P file 55',
          null,
          'u1',
          `${digest}:55:c1`
        ]
      ]
    );
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
            { claimNumber: '20261105-1001', rejection: null, payerClaimNumber: 'PCN-1' },
            { claimNumber: '20261105-2002', rejection: 'Invalid member ID' }
          ]
        },
        { createdAt }
      )
    );
    assert.deepEqual(outcomes(out.items), [
      ['20261105-1001', 'c1', 'accepted', 'Accepted (A2): Accepted into adjudication'],
      ['20261105-2002', null, 'unmatched', 'No claim has number 20261105-2002']
    ]);
    assert.deepEqual(
      events.map((e) => e.parameters),
      [
        [
          't1',
          'c1',
          'accepted',
          'cov1',
          'Accepted (A2): Accepted into adjudication',
          'PCN-1',
          'u1',
          `${digest}:1`
        ]
      ]
    );
  });

  it('keeps no payer claim number from a 277CA rejection, so a resubmission is a new claim', async () => {
    const { events, digest } = await apply(
      build277(
        {
          claims: [
            {
              claimNumber: '20261105-1001',
              rejection: 'Invalid member ID',
              payerClaimNumber: 'PCN-9'
            }
          ]
        },
        { createdAt }
      )
    );
    assert.deepEqual(
      events.map((e) => e.parameters),
      [
        [
          't1',
          'c1',
          'rejected',
          'cov1',
          'Rejected (A7): Invalid member ID',
          null,
          'u1',
          `${digest}:1`
        ]
      ]
    );
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
    assert.deepEqual(saved?.parameters, [
      'active',
      'MEDICARE PART B',
      createdAt,
      null,
      null,
      null,
      TRACE
    ]);
    assert.deepEqual(
      active.queries
        .filter((q) => q.sql.startsWith('insert into "signals"'))
        .map((q) => q.parameters),
      [['t1', 'claim:c1', 1]]
    );
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
    const { events, digest } = await apply(
      build271({ trace: TRACE, active: false }, { createdAt })
    );
    assert.deepEqual(
      events.map((e) => e.parameters),
      [['t1', 'c1', 'eligibility', TRACE, 'Coverage not active', null, 'u1', `${digest}:1`]]
    );
  });

  it('asks a biller to bill the Medicare Advantage plan a Medicare answer names', async () => {
    const { db } = createRecordingDb(({ sql }) =>
      sql.includes('"claim_coverages"."id" in ($')
        ? [{ id: TRACE, claim_id: 'c1', claim_filing: 'MB' }]
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
      runId: null,
      sourceKey: null,
      fileName: 'a.271',
      document: {},
      file: read.value,
      now: createdAt,
      postings: []
    });
    assert.deepEqual(outcomes(out.items), [
      [TRACE, 'c1', 'review', 'Bill the Medicare Advantage plan instead: SUNSHINE; MEDICARE PART B']
    ]);
  });

  it('rejects the 837P batch a TA1 rejects, sending its claims back to review', async () => {
    const ta1 = buildTA1(
      { sender: 'SUB01', receiver: 'X', controlNumber: '55', production: false },
      '008',
      createdAt
    );
    const { out, events, digest } = await apply(ta1);
    assert.equal(out.kind, 'TA1');
    assert.equal(
      out.envelopeRejection,
      'The clearinghouse rejected the file envelope: interchange 55: Invalid interchange receiver ID (TA1 note 008)'
    );
    assert.deepEqual(outcomes(out.items), [
      [
        '20261105-1001',
        'c1',
        'rejected',
        'The clearinghouse rejected the file envelope of 837P file 55: Invalid interchange receiver ID (TA1 note 008)'
      ]
    ]);
    assert.deepEqual(
      events.map((e) => e.parameters),
      [
        [
          't1',
          'c1',
          'rejected',
          'cov1',
          'The clearinghouse rejected the file envelope of 837P file 55: Invalid interchange receiver ID (TA1 note 008)',
          null,
          'u1',
          `${digest}:000000055:c1`
        ]
      ]
    );
    const unknown = await apply(
      buildTA1(
        { sender: 'S', receiver: 'X', controlNumber: '77', production: false },
        '008',
        createdAt
      )
    );
    assert.deepEqual(outcomes(unknown.out.items), [
      ['000000077', null, 'unmatched', 'No 837P file has control number 000000077']
    ]);
    assert.equal(
      unknown.out.envelopeRejection,
      'The clearinghouse rejected the file envelope: interchange 77: Invalid interchange receiver ID (TA1 note 008)'
    );
  });

  it('logs payer claim status answers on the claim they name', async () => {
    const { out, events, digest } = await apply(
      build277Status([
        {
          trace: '20261105-1001',
          claimNumber: '20261105-1001',
          category: 'F1',
          code: '65',
          payerClaimNumber: 'P9'
        },
        { trace: '20261105-2002', claimNumber: '20261105-2002', category: 'A4', code: '35' }
      ])
    );
    assert.equal(out.kind, '277S');
    assert.deepEqual(outcomes(out.items), [
      ['20261105-1001', 'c1', 'status', 'Paid (F1:65): Finalized: payment: Claim has been paid'],
      ['20261105-2002', null, 'unmatched', 'No claim has number 20261105-2002']
    ]);
    assert.equal(out.envelopeRejection, null);
    assert.deepEqual(
      events.map((e) => e.parameters),
      [
        [
          't1',
          'c1',
          'claim_status',
          'cov1',
          'Paid (F1:65): Finalized: payment: Claim has been paid',
          'P9',
          'u1',
          `${digest}:1`
        ]
      ]
    );
  });
});
