import assert from 'node:assert/strict';
import { createRecordingDb } from '@ugula/db/testing';
import type { Report, ReportContext } from './report.ts';
import type { ReportPage } from './schemas.ts';

export const reportContext: ReportContext = {
  agencyId: 't-1',
  tz: 'America/New_York',
  now: '2026-10-23T15:00:00.000Z',
  today: '2026-10-23',
  range: { from: '2026-01-01', to: '2026-10-23' },
  group: ''
};

export const compileReport = async (report: Report, group = '', page: ReportPage = 1) => {
  const { db, queries } = createRecordingDb(() => [{ total: '1', paid_cents: 5 }]);
  const result = await report.run(db, { ...reportContext, group }, page);
  const [rows, totals] = queries;
  assert.ok(rows && totals);
  return { result, rows, totals };
};
