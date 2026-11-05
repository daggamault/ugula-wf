import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Values } from '@ugula/graph';
import { invokeNode } from '@ugula/graph/testing';
import type { FacilityInvoiceSource } from '../documents.ts';
import { billingStores } from '../testing.ts';
import { scheduleNodes } from './schedules.ts';
import type { ScheduleStore } from './stores.ts';

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
      number: 12,
      pcrNumber: 'PCR-1',
      patient: 'Doe, Jane',
      serviceDate: '2026-10-02',
      chargeCents: 90_000,
      balanceCents: 75_000
    }
  ]
};

const setup = () => {
  const calls: unknown[][] = [];
  const schedules: ScheduleStore = {
    deadlines: async (_, today) => {
      calls.push(['deadlines', today]);
      return [];
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
  it("finds the deadlines as of the agency's today and raises tasks", async () => {
    const { calls, run } = setup();
    assert.deepEqual((await run('find-deadlines', {})).outputs.deadlines, []);
    await run('raise-task', { taskId: 't1', priority: 3 });
    assert.deepEqual(calls, [
      ['today', '2026-11-01T03:00:00.000Z'],
      ['deadlines', '2026-10-31'],
      ['raise', 't1', 3]
    ]);
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
      /not the first day of a month/
    );
  });
});
