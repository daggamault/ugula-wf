import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Json } from '@ugula/graph';
import { createElement } from 'react';
import { claimDetail } from '../../shared/claims/testing.ts';
import { formatDate } from '../../shared/format.ts';
import { render, screen, within } from '../../shared/testing-dom.ts';
import { headlineOf, MismatchAlert, PatientFacts, TaskIssue } from './task-brief.tsx';

const issue = (severity: 'blocking' | 'warning', message: string, field = 'msp') => ({
  code: message,
  field,
  message,
  coverageId: null,
  severity
});

type Task = Parameters<typeof TaskIssue>[0]['task'];

const TASK: Task = {
  kind: 'task',
  title: 'Review PCR',
  summary: null,
  instructions: '',
  context: null
};

const showIssue = (patch: Partial<Task>, children?: string) =>
  render(createElement(TaskIssue, { task: { ...TASK, ...patch } }, children));

const panel = (name: string) => screen.getByRole('region', { name });

const listItems = (el: HTMLElement) =>
  within(el)
    .getAllByRole('listitem')
    .map((li) => li.textContent);

const details = (el: HTMLElement) =>
  [...el.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]);

describe('headlineOf', () => {
  const context = { issues: [issue('warning', 'Warn'), issue('blocking', 'Block')] };

  it('uses the summary first', () => {
    assert.equal(headlineOf({ summary: 'Denied: CO-16', context, title: 'T' }), 'Denied: CO-16');
  });

  it('falls back to the first blocking issue, then the first issue', () => {
    assert.equal(headlineOf({ summary: null, context, title: 'T' }), 'Block');
    assert.equal(
      headlineOf({ summary: '', context: { issues: [issue('warning', 'Warn')] }, title: 'T' }),
      'Warn'
    );
  });

  it('falls back to the title without issues or with malformed ones', () => {
    assert.equal(headlineOf({ summary: null, context: null, title: 'T' }), 'T');
    assert.equal(headlineOf({ summary: null, context: { issues: [] }, title: 'T' }), 'T');
    assert.equal(
      headlineOf({ summary: null, context: { issues: [{ message: 'x' }] }, title: 'T' }),
      'T'
    );
  });
});

describe('TaskIssue', () => {
  it('heads a task with the issue and a fault with what went wrong', () => {
    showIssue({});
    assert.ok(within(panel('The Issue')).getByText('Review PCR'));
    showIssue({ kind: 'fault', title: 'Stuck', summary: 'Timed out' });
    assert.ok(within(panel('What Went Wrong')).getByText('Timed out'));
  });

  it('lists the non-empty reasons', () => {
    showIssue({ context: { reasons: ['Responded emergent', '', 3, 'Lights on'] } });
    assert.deepEqual(listItems(panel('The Issue')), ['Responded emergent', 'Lights on']);
  });

  it('splits claim issues into what must be fixed and what is worth checking', () => {
    showIssue({
      context: {
        issues: [issue('blocking', 'No payer', 'payer'), issue('warning', 'Check MSP')]
      }
    });
    const [danger] = screen.getAllByRole('alert');
    assert.ok(danger);
    assert.equal(danger.querySelector('strong')?.textContent, 'Must Be Fixed');
    assert.deepEqual(listItems(danger), ['Payer: No payer']);
    const [warning] = screen.getAllByRole('status');
    assert.ok(warning);
    assert.equal(warning.querySelector('strong')?.textContent, 'Worth Checking');
    assert.deepEqual(listItems(warning), ['Medicare Secondary Payer: Check MSP']);
  });

  it('shows the warnings and notes the workflow left', () => {
    showIssue({ context: { warnings: ['Late filing', ''], notes: ['Called payer'] } });
    assert.deepEqual(
      screen
        .getAllByRole('status')
        .map((s) => [s.querySelector('strong')?.textContent, ...listItems(s)]),
      [
        ['Warnings', 'Late filing'],
        ['Notes', 'Called payer']
      ]
    );
  });

  it("says what's needed only when there are instructions", () => {
    showIssue({ instructions: 'Confirm the service.' });
    assert.ok(screen.getByRole('heading', { name: "What's Needed" }));
    assert.ok(screen.getByText('Confirm the service.'));
  });

  it('shows nothing extra for a task with no context or instructions', () => {
    showIssue({ context: 'odd' as Json });
    assert.ok(!screen.queryByRole('heading', { name: "What's Needed" }));
    assert.ok(!screen.queryByRole('list'));
    assert.ok(!screen.queryByRole('status'));
    assert.ok(!screen.queryByRole('alert'));
  });

  it('shows what is passed below the issue', () => {
    showIssue({}, 'Pick an outcome');
    assert.ok(within(panel('The Issue')).getByText('Pick an outcome'));
  });
});

describe('MismatchAlert', () => {
  it('names the one value that differs and links to the encounter', () => {
    render(
      createElement(MismatchAlert, {
        mismatches: [{ field: 'memberId', label: 'Member ID', encounter: 'X1' }],
        encounterHref: '/encounters/e1'
      })
    );
    const alert = screen.getByRole('status');
    assert.ok(within(alert).getByText(/1 value differs from the encounter: Member ID\./));
    assert.equal(
      within(alert).getByRole('link', { name: 'Open Encounter' }).getAttribute('href'),
      '/encounters/e1'
    );
  });

  it('counts several differing values and has no link without an encounter', () => {
    render(
      createElement(MismatchAlert, {
        mismatches: [
          { field: 'patient', label: 'Patient', encounter: 'Doe, John' },
          { field: 'loadedMiles', label: 'Loaded Miles', encounter: '7' }
        ],
        encounterHref: undefined
      })
    );
    const alert = screen.getByRole('status');
    assert.equal(alert.textContent, '2 values differ from the encounter: Patient, Loaded Miles.');
    assert.ok(!within(alert).queryByRole('link'));
  });

  it('shows nothing when everything matches', () => {
    render(createElement(MismatchAlert, { mismatches: [], encounterHref: '/encounters/e1' }));
    assert.ok(!screen.queryByRole('status'));
  });
});

describe('PatientFacts', () => {
  it('shows the patient the claim bills for, linked to their record', () => {
    render(createElement(PatientFacts, { claim: { ...claimDetail, gender: 'F' }, taskId: 't1' }));
    const record = panel('Patient Record');
    assert.equal(
      within(record)
        .getByRole('link', { name: `Patient ${claimDetail.patient_number}` })
        .getAttribute('href'),
      `/patients/${claimDetail.patient_id}?back=%2Ftasks%2Ft1`
    );
    assert.deepEqual(details(record), [
      ['Name', 'Doe, Jane'],
      ['Birth Date', formatDate('1958-04-12')],
      ['Sex', 'Female'],
      ['Address', '1 Main St, Springfield, IL 62704']
    ]);
  });

  it('shows dashes for facts the patient record lacks', () => {
    render(
      createElement(PatientFacts, {
        claim: {
          ...claimDetail,
          last_name: null,
          birth_date: null,
          gender: null,
          address_line: null,
          city: null,
          state: null,
          postal_code: null
        },
        taskId: 't1'
      })
    );
    assert.deepEqual(details(panel('Patient Record')), [
      ['Name', '—'],
      ['Birth Date', '—'],
      ['Sex', '—'],
      ['Address', '—']
    ]);
  });

  it('flags the name and birth date the encounter disagrees with, ignoring others', () => {
    render(
      createElement(PatientFacts, {
        claim: claimDetail,
        taskId: 't1',
        mismatches: [
          { field: 'patient', label: 'Patient', encounter: 'Doe, Janet' },
          { field: 'birthDate', label: 'Birth Date', encounter: '1958-04-21' },
          { field: 'memberId', label: 'Member ID', encounter: 'X1' }
        ],
        encounterHref: '/encounters/e1'
      })
    );
    const record = panel('Patient Record');
    assert.ok(
      within(record).getByText(/2 values differ from the encounter: Patient, Birth Date\./)
    );
    assert.deepEqual(details(record).slice(0, 2), [
      ['Name', 'Doe, JaneEncounter says Doe, Janet'],
      ['Birth Date', `${formatDate('1958-04-12')}Encounter says ${formatDate('1958-04-21')}`]
    ]);
  });

  it('says when no patient is matched yet', () => {
    render(
      createElement(PatientFacts, { claim: { ...claimDetail, patient_id: null }, taskId: 't1' })
    );
    const record = panel('Patient Record');
    assert.ok(within(record).getByText('No patient is matched to this claim yet.'));
    assert.ok(!within(record).queryByRole('link'));
  });
});
