import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { claimDetail } from '../../shared/claims/testing.ts';
import { headlineOf, PatientFacts, TaskIssue } from './task-brief.tsx';

const issue = (severity: 'blocking' | 'warning', message: string) => ({
  code: message,
  field: 'msp',
  message,
  coverageId: null,
  severity
});

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
  it('shows the patient the claim bills for, linked to their record', () => {
    const html = renderToStaticMarkup(
      createElement(PatientFacts, { claim: { ...claimDetail, gender: 'F' }, taskId: 't1' })
    );
    assert.ok(
      html.includes('Patient Record') &&
        html.includes(`href="/patients/${claimDetail.patient_id}?back=%2Ftasks%2Ft1"`)
    );
    assert.ok(html.includes('Doe, Jane') && html.includes('Female'));
    assert.ok(html.includes('1 Main St, Springfield, IL 62704'));
    const none = renderToStaticMarkup(
      createElement(PatientFacts, { claim: { ...claimDetail, patient_id: null }, taskId: 't1' })
    );
    assert.ok(none.includes('No patient is matched to this claim yet.'));
  });
});
