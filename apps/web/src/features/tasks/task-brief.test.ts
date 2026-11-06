import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TaskClaim } from './client.ts';
import { headlineOf, PatientFacts, TaskIssue } from './task-brief.tsx';

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
  classification: 'scheduled',
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
    assert.ok(html.includes('The Issue') && html.includes('>Review PCR</p>'));
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

describe('PatientFacts', () => {
  it('shows the patient record and the insurance billed on the claim', () => {
    const html = renderToStaticMarkup(
      createElement(PatientFacts, {
        patient: {
          id: 'p1',
          number: 'P-7',
          firstName: 'Jane',
          lastName: 'Doe',
          birthDate: '1950-02-03',
          sex: 'F',
          addressLine: '1 Main St',
          city: 'Harrisburg',
          state: 'PA',
          postalCode: '17101'
        },
        payers: claim.payers,
        taskId: 't1'
      })
    );
    assert.ok(
      html.includes('Patient Record') && html.includes('href="/patients/p1?back=%2Ftasks%2Ft1"')
    );
    assert.ok(html.includes('Doe, Jane') && html.includes('Female'));
    assert.ok(html.includes('1 Main St, Harrisburg, PA 17101'));
    assert.ok(html.includes('1EG4 · not active') && html.includes('Medicaid'));
    const none = renderToStaticMarkup(
      createElement(PatientFacts, { patient: null, payers: null, taskId: 't1' })
    );
    assert.ok(none.includes('No patient is matched to this claim yet.'));
  });
});
