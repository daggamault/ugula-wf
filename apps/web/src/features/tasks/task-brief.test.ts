import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TaskClaim } from './client.ts';
import { ClaimFacts, headlineOf, TaskIssue } from './task-brief.tsx';

const issue = (severity: 'blocking' | 'warning', message: string) => ({
  code: message,
  field: 'msp',
  message,
  coverageId: null,
  severity
});

const claim: TaskClaim = {
  id: 'c1',
  number: '20261101-0012',
  status: 'draft',
  patient: 'Doe, Jane',
  birthDate: '1950-02-03',
  serviceDate: '2026-09-14',
  tripType: 'scheduled',
  level: 'BLS',
  emergency: false,
  loadedMiles: '8.3',
  totalCents: 92865,
  balanceCents: 92865,
  payers: [
    { payer: 'Medicare', memberId: '1EG4', eligibility: 'inactive' },
    { payer: 'Medicaid', memberId: null, eligibility: null }
  ],
  lines: [{ code: 'A0428', units: 1, totalCents: 80000 }]
};

describe('headlineOf', () => {
  it('uses the summary, else the first blocking issue, else the title', () => {
    const context = { issues: [issue('warning', 'Warn'), issue('blocking', 'Block')] };
    assert.equal(headlineOf({ summary: 'Denied: CO-16', context, title: 'T' }), 'Denied: CO-16');
    assert.equal(headlineOf({ summary: null, context, title: 'T' }), 'Block');
    assert.equal(
      headlineOf({ summary: null, context: { issues: [issue('warning', 'Warn')] }, title: 'T' }),
      'Warn'
    );
    assert.equal(headlineOf({ summary: null, context: null, title: 'T' }), 'T');
  });
});

describe('TaskIssue', () => {
  it('says what is wrong, why and what is needed', () => {
    const html = renderToStaticMarkup(
      createElement(TaskIssue, {
        task: {
          kind: 'task',
          title: 'Review PCR',
          summary: null,
          instructions: 'Confirm the service.',
          context: { reasons: ['Responded emergent', ''] }
        }
      })
    );
    assert.ok(html.includes('The Issue') && html.includes('>Review PCR<'));
    assert.ok(html.includes('<li>Responded emergent</li>') && !html.includes('<li></li>'));
    assert.ok(html.includes('Confirm the service.'));
    const fault = renderToStaticMarkup(
      createElement(TaskIssue, {
        task: {
          kind: 'fault',
          title: 'Stuck',
          summary: 'Timed out',
          instructions: '',
          context: null
        }
      })
    );
    assert.ok(fault.includes('What Went Wrong') && !fault.includes('What&#x27;s Needed'));
  });
});

describe('ClaimFacts', () => {
  it('shows the claim snapshot and links the claim back to the task', () => {
    const html = renderToStaticMarkup(createElement(ClaimFacts, { claim, taskId: 't1' }));
    assert.ok(html.includes('href="/claims/c1?back=%2Ftasks%2Ft1"'));
    assert.ok(html.includes('Scheduled') && html.includes('BLS non-emergency'));
    assert.ok(html.includes('1EG4 · not active') && html.includes('Medicaid'));
    assert.ok(html.includes('A0428 × 1') && html.includes('8.3'));
    const bare = renderToStaticMarkup(
      createElement(ClaimFacts, {
        claim: { ...claim, patient: null, payers: [], lines: [], tripType: 'unknown', level: null },
        taskId: 't1'
      })
    );
    assert.ok(bare.includes('Not matched yet') && bare.includes('Patient only'));
  });
});
