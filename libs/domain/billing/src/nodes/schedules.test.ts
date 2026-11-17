import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Values } from '@ugula/graph';
import { invokeNode } from '@ugula/graph/testing';
import type { FacilityInvoiceSource } from '../documents.ts';
import { billingStores } from '../testing.ts';
import { scheduleNodes } from './schedules.ts';
import type { DeadlineFacts, ScheduleStore } from './stores.ts';

const source: FacilityInvoiceSource = {
  facilityId: 'f1',
  agency: {
    name: 'Metro EMS',
    addressLine: null,
    city: null,
    state: null,
    postalCode: null,
    phone: '2175550100'
  },
  facility: ['Sunrise SNF'],
  period: '2026-10-01',
  claims: [
    {
      claimId: 'c12',
      number: '20261002-0012',
      pcrNumber: 'PCR-1',
      patient: 'Doe, Jane',
      serviceDate: '2026-10-02',
      chargeCents: 90_000,
      balanceCents: 75_000
    }
  ]
};

const claim = { claimId: 'c1', patientId: 'p1', reference: '20261002-0012 · PCR-1 · Jane Doe' };

const facts: DeadlineFacts = {
  filings: [
    {
      ...claim,
      coverageId: 'cov1',
      claimFiling: 'MB',
      filingLimitDays: null,
      serviceDate: '2026-10-02'
    }
  ],
  certifications: [{ ...claim, signedOn: '2026-09-15', serviceDate: '2026-10-02' }],
  tasks: [
    {
      workflow: 'billing.work-denial',
      ...claim,
      dueOn: '2026-11-10',
      taskId: 't1',
      priority: 0
    }
  ],
  reminders: [
    { kind: 'pcs', claimId: 'c1', patientId: 'p1', dueOn: '2026-11-14', openedOn: '2026-10-31' }
  ]
};

const setup = () => {
  const calls: unknown[][] = [];
  const schedules: ScheduleStore = {
    deadlineFacts: async (_, since) => {
      calls.push(['deadlines', since]);
      return facts;
    },
    raiseTask: async (_, taskId, priority) => void calls.push(['raise', taskId, priority]),
    facilityInvoices: async (_, period) => (period === '2026-10-01' ? [source] : []),
    saveFacilityInvoice: async (_, key, invoice) =>
      void calls.push(['invoice', key, invoice.totalCents, invoice.pdf.length > 0])
  };
  const calendar = {
    today: async (_: string, at: Date) => {
      calls.push(['today', at.toISOString()]);
      return '2026-10-31';
    }
  };
  const nodes = scheduleNodes(() => billingStores({ schedules, calendar }));
  const run = (type: string, inputs: Values) => {
    const node = nodes.find((n) => n.type === `billing.${type}`);
    if (!node) throw new Error(`No node ${type}`);
    return invokeNode(node, { inputs, now: new Date('2026-11-01T03:00:00.000Z') });
  };
  return { calls, run };
};

describe('scheduleNodes', () => {
  it('reads what the deadlines are worked out from and raises tasks', async () => {
    const { calls, run } = setup();
    assert.deepEqual((await run('read-deadlines', { since: '2026-09-01' })).outputs, facts);
    await run('raise-task', { taskId: 't1', priority: 3 });
    assert.deepEqual(calls, [
      ['deadlines', '2026-09-01'],
      ['raise', 't1', 3]
    ]);
    for (const since of ['soon', '2026-02-30']) {
      await assert.rejects(
        () => run('read-deadlines', { since }),
        new RegExp(`${since} is not a date`)
      );
    }
  });

  it("gives today's date in the agency's time zone, not UTC", async () => {
    const { run } = setup();
    assert.deepEqual((await run('agency-today', {})).outputs, { today: '2026-10-31' });
  });

  it('issues one invoice per facility for a month on the agency date, and refuses other days', async () => {
    const { calls, run } = setup();
    const issued = await run('issue-facility-invoices', { period: '2026-10-01' });
    assert.deepEqual(issued.outputs, { invoices: 1, claims: 1 });
    assert.deepEqual(calls, [
      ['today', '2026-11-01T03:00:00.000Z'],
      ['invoice', 'key:f1', 75_000, true]
    ]);
    await assert.rejects(
      () => run('issue-facility-invoices', { period: '2026-10-15' }),
      /2026-10-15 is not the first day of a month/
    );
  });

  it('issues nothing for a month without facility trips', async () => {
    const { calls, run } = setup();
    const issued = await run('issue-facility-invoices', { period: '2026-09-01' });
    assert.deepEqual(issued.outputs, { invoices: 0, claims: 0 });
    assert.deepEqual(calls, [['today', '2026-11-01T03:00:00.000Z']]);
  });

  it('refuses to raise a task without its id', async () => {
    const { calls, run } = setup();
    await assert.rejects(() => run('raise-task', { taskId: ' ', priority: 3 }), /No task to raise/);
    assert.deepEqual(calls, []);
  });
});
