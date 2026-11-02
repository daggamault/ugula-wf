import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createReportService, rangeOf } from './service.ts';

const now = new Date('2026-10-23T15:00:00Z');

describe('rangeOf', () => {
  it('defaults to the last twelve months, from the first of the month', () => {
    assert.deepEqual(rangeOf({}, now), { from: '2025-11-01', to: '2026-10-23' });
    assert.deepEqual(rangeOf({ to: '2026-03-31' }, now), { from: '2025-04-01', to: '2026-03-31' });
    assert.deepEqual(rangeOf({ from: '2026-01-01', to: '2026-01-31' }, now), {
      from: '2026-01-01',
      to: '2026-01-31'
    });
  });
});

describe('report service', () => {
  it('runs each report for the tenant and echoes the period it covers', async () => {
    const { db, queries } = createRecordingDb(() => [{ paid_cents: 5, adjusted_cents: 1 }]);
    const service = createReportService({ db, now: () => now });
    const aging = await service.aging('t-1');
    assert.ok(aging.ok && aging.value.asOf === '2026-10-23');
    const monthly = await service.monthly('t-1', { from: '2026-01-01' });
    assert.ok(monthly.ok);
    assert.deepEqual(monthly.value.range, { from: '2026-01-01', to: '2026-10-23' });
    assert.ok((await service.hcpcs('t-1', {})).ok);
    const payers = await service.payers('t-1', {});
    assert.ok(payers.ok);
    assert.deepEqual(payers.value.patient, { paid_cents: 5, adjusted_cents: 1 });
    assert.ok(queries.every((q) => q.parameters.includes('t-1')));
  });
});
