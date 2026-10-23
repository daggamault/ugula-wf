import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClaimEvent } from './claims.ts';
import {
  type ClaimStore,
  createBillingNodes,
  type FeeStore,
  type NewClaim,
  type PatientStore
} from './nodes.ts';
import type { Patient } from './patients.ts';

const jane: Patient = {
  id: 'p1',
  firstName: 'Jane',
  lastName: 'Doe',
  birthDate: '1980-01-02',
  gender: null,
  addressLine: null,
  city: null,
  state: null,
  postalCode: null
};

const memoryStore = (existing: Patient[]) => {
  const calls: unknown[][] = [];
  const store: PatientStore = {
    findCandidates: async (runId, query) => {
      calls.push(['findCandidates', runId, query]);
      return existing;
    },
    findPatient: async (runId, id) => {
      calls.push(['findPatient', runId, id]);
      return existing.find((p) => p.id === id) ?? null;
    },
    createPatient: async (runId, key, patient, reuseMatch) => {
      calls.push(['createPatient', runId, key, reuseMatch]);
      return { id: 'new', ...patient };
    }
  };
  return { store, calls };
};

const fees: FeeStore = {
  findFees: async (_, payer, codes) =>
    Object.fromEntries(
      codes
        .filter((c) => c !== 'A0999')
        .map((c) => [c, payer === 'medicare' && c === 'A0427' ? 50000 : 95000])
    )
};

const memoryClaims = () => {
  const opened: NewClaim[] = [];
  const events: (ClaimEvent & { key: string; note: string })[] = [];
  const closed: string[] = [];
  const attached: string[] = [];
  const store: ClaimStore = {
    statementData: async () => {
      throw new Error('no statements here');
    },
    saveStatement: async () => undefined,
    attachCycle: async (_, __, cycleRunId) => {
      attached.push(cycleRunId);
    },
    openClaim: async (_, __, claim) => {
      opened.push(claim);
      return 'c1';
    },
    ledger: async (_, id) =>
      id === 'c1'
        ? {
            totalCents: 100_000,
            coverages: (opened[0]?.coverages ?? []).map((c) => ({
              id: `cov-${c.payer}`,
              payer: c.payer
            })),
            events
          }
        : null,
    recordEvent: async (_, __, key, e) => {
      events.push({ ...e, key, paidCents: 0, adjustedCents: 0, at: '2026-01-01T00:00:00.000Z' });
    },
    closeClaim: async (_, __, ___, status) => {
      closed.push(status);
    }
  };
  return { store, opened, events, closed, attached };
};

const withFees = (patients: PatientStore, claims = memoryClaims().store) => ({
  patients,
  fees,
  claims
});

const invoke = (values: Record<string, unknown>) => ({
  read: async (pin: string) => values[pin] ?? null,
  ctx: { runId: 'r1', key: 'r1:s:n:0', now: new Date('2026-01-01T00:00:00.000Z') }
});

const demographics = { firstName: 'J', lastName: ' doe', birthDate: '1980-01-02' };

describe('createBillingNodes', () => {
  it('routes report demographics to matched, unmatched or review', async () => {
    const { store, calls } = memoryStore([jane]);
    const [match] = createBillingNodes(withFees(store));
    const res = await match?.run(invoke({ demographics }));
    assert.deepEqual(res, {
      type: 'next',
      pin: 'matched',
      outputs: {
        patient: jane,
        candidates: [],
        reason: '',
        demographics: {
          ...demographics,
          lastName: 'doe',
          gender: null,
          addressLine: null,
          city: null,
          state: null,
          postalCode: null
        }
      }
    });
    assert.deepEqual(calls[0], [
      'findCandidates',
      'r1',
      { birthDate: '1980-01-02', lastNameKey: 'doe', firstName: 'J' }
    ]);
    const review = await match?.run(
      invoke({ demographics: { lastName: 'Doe', birthDate: { '@nil': 'true' } } })
    );
    assert.equal(review?.pin, 'review');
    assert.deepEqual(review?.outputs.demographics, {
      firstName: null,
      lastName: 'Doe',
      birthDate: null,
      gender: null,
      addressLine: null,
      city: null,
      state: null,
      postalCode: null
    });
    assert.deepEqual(review?.outputs.candidates, []);
    const [fresh] = createBillingNodes(withFees(memoryStore([]).store));
    assert.equal((await fresh?.run(invoke({ demographics })))?.pin, 'unmatched');
  });

  it('creates patients idempotently per step and loads chosen ones', async () => {
    const { store, calls } = memoryStore([jane]);
    const [, create, find] = createBillingNodes(withFees(store));
    const created = await create?.run(invoke({ demographics }));
    assert.deepEqual(created?.outputs.patient, {
      id: 'new',
      firstName: 'J',
      lastName: 'doe',
      birthDate: '1980-01-02',
      gender: null,
      addressLine: null,
      city: null,
      state: null,
      postalCode: null
    });
    assert.deepEqual(calls.at(-1), ['createPatient', 'r1', 'r1:s:n:0', false]);
    await create?.run(invoke({ demographics, reuseMatch: true }));
    assert.deepEqual(calls.at(-1), ['createPatient', 'r1', 'r1:s:n:0', true]);
    await assert.rejects(
      async () => create?.run(invoke({ demographics: { lastName: 'Doe' } })),
      /needs a first name, last name and valid birth date/
    );
    assert.deepEqual((await find?.run(invoke({ patientId: 'p1' })))?.outputs, { patient: jane });
    await assert.rejects(async () => find?.run(invoke({ patientId: 'p9' })), /does not exist/);
    await assert.rejects(async () => find?.run(invoke({})), /Choose a patient/);
  });

  it('prices claim lines with payer-specific fees and faults on unscheduled codes', async () => {
    const price = createBillingNodes(withFees(memoryStore([]).store))[3];
    const lines = [
      { code: 'A0427', units: 1 },
      { code: 'A0425', units: 2.5 }
    ];
    assert.deepEqual((await price?.run(invoke({ lines, payer: 'medicare' })))?.outputs, {
      lines: [
        { code: 'A0427', units: 1, unitCents: 50000, totalCents: 50000 },
        { code: 'A0425', units: 2.5, unitCents: 95000, totalCents: 237500 }
      ],
      totalCents: 287500
    });
    await assert.rejects(
      async () => price?.run(invoke({ lines: [{ code: 'A0999', units: 1 }] })),
      /No fee scheduled for A0999/
    );
  });

  it('opens a claim, walks its payer cycle and closes it', async () => {
    const claims = memoryClaims();
    const nodes = createBillingNodes(withFees(memoryStore([]).store, claims.store));
    const [open, attach, step, record, , close] = nodes.slice(4);
    const charges = {
      level: 'ALS1',
      emergency: true,
      loadedMiles: 12.4,
      lines: [{ code: 'A0427', units: 1, unitCents: 100_000, totalCents: 100_000 }],
      totalCents: 100_000
    };
    const opened = await open?.run(
      invoke({
        patient: jane,
        summary: {
          pcrNumber: ' PCR-1 ',
          incidentAt: '2026-10-01T08:15:00Z',
          primaryImpression: 'R07.9',
          coverages: [
            { payer: 'Blue', priority: '2611005' },
            { payer: 'Medicare', priority: '2611003', memberId: 'M1' },
            { payer: ' ' }
          ]
        },
        charges,
        report: { bucket: 'ugula', key: 'imports/t/f.xml.reports/00000.json' }
      })
    );
    assert.deepEqual(opened?.outputs, { claimId: 'c1' });
    assert.deepEqual(
      claims.opened[0]?.coverages.map((c) => c.payer),
      ['Medicare', 'Blue']
    );
    assert.equal(claims.opened[0]?.reportKey, 'imports/t/f.xml.reports/00000.json');
    await attach?.run(invoke({ claimId: 'c1', cycleRunId: 'run-9' }));
    assert.deepEqual(claims.attached, ['run-9']);
    assert.equal(claims.opened[0]?.pcrNumber, 'PCR-1');
    assert.equal(claims.opened[0]?.coverages[0]?.memberId, 'M1');
    assert.deepEqual(claims.opened[0]?.details.diagnoses, ['R079']);
    assert.equal(claims.opened[0]?.details.serviceDate, '2026-10-01');

    const next = async () => step?.run(invoke({ claimId: 'c1' }));
    assert.deepEqual(await next(), {
      type: 'next',
      pin: 'submit',
      outputs: {
        coverageId: 'cov-Medicare',
        payer: 'Medicare',
        statementNumber: null,
        balanceCents: 100_000,
        waitMs: 86_400_000
      }
    });
    await assert.rejects(
      async () =>
        record?.run(invoke({ claimId: 'c1', kind: 'submitted', coverageId: 'cov-Medicare' })),
      /Unknown claim event/
    );
    claims.events.push({
      kind: 'submitted',
      coverageId: 'cov-Medicare',
      key: 'batch',
      note: '',
      paidCents: 0,
      adjustedCents: 0,
      at: '2026-01-01T00:00:00.000Z'
    });
    assert.equal((await next())?.pin, 'await');
    await record?.run(invoke({ claimId: 'c1', kind: 'payer_skipped', coverageId: 'cov-Medicare' }));
    const before = claims.events.length;
    await record?.run(invoke({ claimId: 'c1', kind: 'follow_up', coverageId: 'cov-Medicare' }));
    assert.equal(claims.events.length, before);
    await record?.run(invoke({ claimId: 'c1', kind: 'payer_skipped', coverageId: 'cov-Blue' }));
    assert.deepEqual((await next())?.outputs.statementNumber, 1);
    await assert.rejects(
      async () => record?.run(invoke({ claimId: 'c1', kind: 'paid' })),
      /Unknown claim event/
    );
    await close?.run(invoke({ claimId: 'c1', status: 'written_off' }));
    assert.deepEqual(claims.closed, ['written_off']);
    await assert.rejects(
      async () => close?.run(invoke({ claimId: 'c1', status: 'gone' })),
      /Unknown claim status/
    );
    await assert.rejects(async () => step?.run(invoke({ claimId: 'c9' })), /does not exist/);
    await assert.rejects(
      async () => open?.run(invoke({ patient: jane, charges: {} })),
      /level of service/
    );
  });

  it('describes signatures without storage for validation in other apps', async () => {
    const nodes = createBillingNodes(null);
    assert.deepEqual(
      nodes.map((n) => `${n.type}@${n.version}`),
      [
        'billing.match-patient@1',
        'billing.create-patient@1',
        'billing.find-patient@1',
        'billing.price-claim@1',
        'billing.open-claim@1',
        'billing.attach-cycle@1',
        'billing.claim-step@1',
        'billing.record-claim-event@1',
        'billing.issue-statement@1',
        'billing.close-claim@1'
      ]
    );
    assert.deepEqual(nodes[0]?.signature.execOut, ['matched', 'unmatched', 'review']);
    await assert.rejects(
      async () => nodes[0]?.run(invoke({ demographics })),
      /only the worker provides/
    );
  });
});
