import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Json } from '@ugula/graph';
import { createElement } from 'react';
import { formatDate, formatDateTime } from '../../shared/format.ts';
import { render, screen, within } from '../../shared/testing-dom.ts';
import { ContextView, labelOf } from './context-view.tsx';

const CLAIM = '01a169fa-2534-79ed-97b7-d7789e899bd6';

const issue = {
  code: 'diagnosis-missing',
  severity: 'blocking',
  field: 'diagnoses',
  message: 'No diagnosis',
  coverageId: null
};

const claimCheck = {
  patientId: 'p1',
  patient: { addressLine: '1 Main St', city: 'Town', state: 'VT', postalCode: '05401' },
  pcrNumber: 'PCR-1',
  classification: 'emergency',
  level: 'ALS1',
  emergency: true,
  loadedMiles: 6.8,
  lines: [{ code: 'A0427', units: 1, unitCents: 90_000, totalCents: 90_000 }],
  totalCents: 90_000,
  payers: [
    {
      coverageId: 'c1',
      name: 'Medicare',
      payerId: 'd1',
      claimFiling: 'MB',
      memberId: 'M1',
      relationship: '01',
      insuredFirstName: 'John',
      insuredLastName: 'Doe'
    }
  ],
  details: {
    serviceDate: '2026-10-01',
    pickup: { name: null, addressLine: null, city: 'Town', state: 'VT', postalCode: null },
    destination: { name: 'General', addressLine: null, city: null, state: null, postalCode: null },
    diagnoses: ['R07.9'],
    originDestination: 'RH'
  }
};

const show = (value: Json | undefined, hideNotices?: boolean) =>
  render(
    createElement(ContextView, {
      label: 'Task context',
      value,
      ...(hideNotices === undefined ? {} : { hideNotices })
    })
  );

const context = () => screen.getByRole('figure', { name: 'Task context' });

const detailsIn = (list: Element | null | undefined) =>
  Object.fromEntries(
    [...(list?.children ?? [])].map((d) => [
      d.querySelector('dt')?.textContent,
      d.querySelector('dd')?.textContent
    ])
  );

const sectionOf = (title: string) => {
  const heading = within(context()).getByRole('heading', { name: title });
  return heading.parentElement as HTMLElement;
};

describe('labelOf', () => {
  it('turns camel case keys into Title Cased labels', () => {
    assert.equal(labelOf('loadedMiles'), 'Loaded Miles');
    assert.equal(labelOf('pcrNumber'), 'PCR Number');
    assert.equal(labelOf('memberId'), 'Member ID');
  });

  it('turns snake and kebab case keys into labels', () => {
    assert.equal(labelOf('first_name'), 'First Name');
    assert.equal(labelOf('pickup-city'), 'Pickup City');
  });

  it('drops the Cents unit from money keys', () => {
    assert.equal(labelOf('balanceCents'), 'Balance');
  });

  it('keeps a key that has no words left as is', () => {
    assert.equal(labelOf('Cents'), 'Cents');
    assert.equal(labelOf('__'), '__');
  });
});

describe('ContextView values', () => {
  it('lists plain values with readable text', () => {
    show({
      balanceCents: 123_456,
      attempts: 12_345,
      emergency: true,
      matched: false,
      birthDate: '1958-04-12',
      receivedAt: '2026-10-01T12:30:00Z',
      impressions: ['I10', 'Z74.09'],
      note: 'Call back'
    });
    assert.deepEqual(detailsIn(context().querySelector('dl')), {
      Balance: '$1,234.56',
      Attempts: (12_345).toLocaleString(),
      Emergency: 'Yes',
      Matched: 'No',
      'Birth Date': formatDate('1958-04-12'),
      'Received At': formatDateTime('2026-10-01T12:30:00Z'),
      Impressions: 'I10, Z74.09',
      Note: 'Call back'
    });
  });

  it('formats times written inside text', () => {
    show({ vitals: '2026-09-05T13:27:00-04:00 · BP 104/62 · HR 104' });
    assert.deepEqual(detailsIn(context().querySelector('dl')), {
      Vitals: `${formatDateTime('2026-09-05T13:27:00-04:00')} · BP 104/62 · HR 104`
    });
  });

  it('links claims, runs and tasks by their ids', () => {
    show({ claimId: CLAIM, runId: CLAIM, taskId: CLAIM });
    assert.deepEqual(
      within(context())
        .getAllByRole('link')
        .map((a) => [a.textContent, a.getAttribute('href')]),
      [
        ['Open Claim', `/claims/${CLAIM}`],
        ['Open Run', `/runs/${CLAIM}`],
        ['Open Task', `/tasks/${CLAIM}`]
      ]
    );
  });

  it('hides empty values and internal ids', () => {
    show({
      coverageId: CLAIM,
      blank: '',
      none: null,
      list: [],
      nested: { a: null, b: [] },
      claimId: 'not-a-uuid',
      kept: 'yes'
    });
    assert.deepEqual(detailsIn(context().querySelector('dl')), {
      'Claim ID': 'not-a-uuid',
      Kept: 'yes'
    });
    assert.ok(!within(context()).queryByRole('heading'));
  });

  it('shows a nested record as its own section', () => {
    show({ patient: { name: 'Jane Doe', birthDate: '1958-04-12', notes: null } });
    assert.deepEqual(detailsIn(sectionOf('Patient').querySelector('dl')), {
      Name: 'Jane Doe',
      'Birth Date': formatDate('1958-04-12')
    });
  });

  it('shows a list of records as counted cards', () => {
    show({
      coverage: [
        { order: 'Primary', payer: 'Medicare' },
        { order: 'Secondary', payer: 'Blue Plan' }
      ]
    });
    const section = sectionOf('Coverage (2)');
    assert.deepEqual(
      within(section)
        .getAllByRole('listitem')
        .map((li) => detailsIn(li.querySelector('dl'))),
      [
        { Order: 'Primary', Payer: 'Medicare' },
        { Order: 'Secondary', Payer: 'Blue Plan' }
      ]
    );
  });

  it('nests records and lists inside a detail', () => {
    show({ patient: { address: { city: 'Town', zip: '05401' }, phones: [['555'], ['556']] } });
    const [address, phones] = [...(sectionOf('Patient').querySelector('dl')?.children ?? [])];
    assert.deepEqual(detailsIn(address?.querySelector('dd dl')), { City: 'Town', ZIP: '05401' });
    assert.deepEqual(
      [...(phones?.querySelectorAll('dd li') ?? [])].map((li) => li.textContent),
      ['555', '556']
    );
  });
});

describe('ContextView notices', () => {
  it('shows claim issues, warnings and notes', () => {
    show({
      issues: [issue, { ...issue, severity: 'warning', field: 'pickup', message: 'No street' }],
      warnings: ['The narrative could not be read'],
      notes: ['Suggested by the model']
    });
    const alerts = within(context()).getAllByRole('alert');
    assert.deepEqual(
      alerts.map((a) => a.textContent),
      ['Must Be FixedDiagnoses: No diagnosis']
    );
    assert.deepEqual(
      within(context())
        .getAllByRole('status')
        .map((s) => s.textContent),
      [
        'Worth CheckingPickup: No street',
        'WarningsThe narrative could not be read',
        'NotesSuggested by the model'
      ]
    );
  });

  it('hides issues, warnings and notes the page already shows', () => {
    show({ issues: [issue], warnings: ['W'], notes: ['N'], kept: 'yes' }, true);
    assert.ok(!within(context()).queryByRole('alert'));
    assert.ok(!within(context()).queryByRole('status'));
    assert.deepEqual(detailsIn(context().querySelector('dl')), { Kept: 'yes' });
  });

  it('ignores issues and notices that are not well formed', () => {
    show({ issues: [{ field: 'nowhere', message: 'x' }], warnings: [1, 2], notes: [] });
    assert.ok(!within(context()).queryByRole('alert'));
    assert.ok(!within(context()).queryByRole('status'));
  });
});

describe('ContextView changes', () => {
  it('lists what changed from the earlier report', () => {
    show({
      changes: [
        { field: 'Birth date', was: '1958-04-12', now: '1958-04-21' },
        { field: 'Miles', was: null, now: 6.8 },
        { field: 'Address', was: { city: 'Town' }, now: '' }
      ]
    });
    const section = sectionOf('Changes (3)');
    assert.deepEqual(
      within(within(section).getByRole('table', { name: 'Changes from the earlier report' }))
        .getAllByRole('row')
        .slice(1)
        .map((row) =>
          within(row)
            .getAllByRole('cell')
            .map((c) => c.lastElementChild?.textContent)
        ),
      [
        ['Birth date', formatDate('1958-04-12'), formatDate('1958-04-21')],
        ['Miles', '—', (6.8).toLocaleString()],
        ['Address', '{"city":"Town"}', '—']
      ]
    );
  });

  it('says when nothing billed from the report changed', () => {
    show({ changes: [], runId: CLAIM });
    assert.ok(
      within(sectionOf('Changes (0)')).getByText('Nothing billed from the report changed.')
    );
  });
});

describe('ContextView claim', () => {
  it('shows a claim check with its charges and payers', () => {
    show({ claim: claimCheck });
    const section = sectionOf('Claim');
    assert.ok(within(section).getByText('Emergency Transport'));
    assert.ok(within(section).getByText('1 Main St, Town, VT 05401'));
    assert.ok(within(section).getByRole('table', { name: 'Claim lines' }));
    assert.ok(within(section).getByRole('table', { name: 'Payers on the claim' }));
  });

  it('opens a wrapped claim and shows its issues once', () => {
    show({ issues: [issue], claim: { claimId: CLAIM, issues: [issue], claim: claimCheck } });
    assert.equal(within(context()).getAllByRole('alert').length, 1);
    assert.equal(
      within(context()).getByRole('link', { name: 'Open Claim' }).getAttribute('href'),
      `/claims/${CLAIM}`
    );
    assert.ok(sectionOf('Claim'));
  });

  it('shows the issues of a wrapped claim when the outer context has none', () => {
    show({ claim: { issues: [issue], note: 'Inner' } });
    assert.deepEqual(
      within(context())
        .getAllByRole('alert')
        .map((a) => a.textContent),
      ['Must Be FixedDiagnoses: No diagnosis']
    );
    assert.ok(within(context()).getByText('Inner'));
  });
});

describe('ContextView plain values', () => {
  it('shows nothing for an empty context', () => {
    const { container } = show(null);
    assert.equal(container.innerHTML, '');
  });

  it('shows a plain value as text', () => {
    const { container } = show(false);
    assert.equal(container.textContent, 'No');
    assert.ok(!screen.queryByRole('figure'));
  });

  it('shows an empty figure for a record with nothing to show', () => {
    show({ a: '', b: [] });
    assert.equal(context().textContent, '');
  });
});
