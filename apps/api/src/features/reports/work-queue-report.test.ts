import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileReport } from './report-testing.ts';
import { workQueueReport } from './work-queue-report.ts';

describe('workQueueReport', () => {
  it('groups open tasks by queue or assignee and ages them from now', async () => {
    const byQueue = await compileReport(workQueueReport, 'queue');
    assert.ok(byQueue.rows.sql.includes('t.queue as "name"'));
    assert.ok(byQueue.rows.parameters.includes('2026-10-23T15:00:00.000Z'));
    const byAssignee = await compileReport(workQueueReport, 'assignee');
    assert.ok(byAssignee.rows.sql.includes('u.email as "name"'));
  });
});
