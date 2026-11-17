import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { formatDate, formatDateTime } from '../../shared/format.ts';
import { render, screen, within } from '../../shared/testing-dom.ts';
import { readPcr } from './pcr-reader.ts';
import { PcrSummaryView } from './pcr-summary.tsx';
import { alsReport, fixtureDictionary } from './testing.ts';

const show = (data: Parameters<typeof readPcr>[0]) =>
  render(createElement(PcrSummaryView, { pcr: readPcr(data, fixtureDictionary) }));

const showAls = () => show(alsReport);

const part = (title: string) => {
  const section = screen.getByRole('heading', { name: title }).closest('section');
  assert.ok(section);
  return section;
};

const details = (title: string) =>
  [...part(title).querySelectorAll('dt')].map((dt) => [
    dt.textContent,
    dt.nextElementSibling?.textContent
  ]);

const rows = (table: string) =>
  within(screen.getByRole('table', { name: table }))
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.lastElementChild?.textContent)
    );

describe('PcrSummaryView', () => {
  it('lays the report out in the sections a biller reads', () => {
    showAls();
    assert.deepEqual(
      screen.getAllByRole('heading').map((h) => h.textContent),
      [
        'Patient',
        'Times',
        'Scene / Pickup',
        'Destination',
        'Response and Disposition',
        'Situation',
        'Vitals',
        'Medications',
        'Procedures',
        'Narrative',
        'Odometer'
      ]
    );
  });

  it('shows the patient, payment method and insurances', () => {
    showAls();
    assert.deepEqual(details('Patient'), [
      ['Name', 'Rosalind Quintero'],
      ['Date of Birth', formatDate('1961-02-19')],
      ['Sex', 'Female 9919001'],
      ['Address', '330 Market St, Harrisburg, PA 17101'],
      ['Phone', '—'],
      ['Payment Method', 'Insurance 2601001']
    ]);
    assert.deepEqual(rows('Insurances on the report'), [
      ['Blue Plan', 'Primary 2611003', 'XGB110093422', 'GRP-10233', 'Self 2622001']
    ]);
  });

  it('shows each call time as a machine-readable time', () => {
    showAls();
    const times = part('Times').querySelectorAll('time');
    assert.equal(times.length, 7);
    assert.equal(times[0]?.getAttribute('dateTime'), '2026-09-06T10:05:00-04:00');
    assert.equal(times[0]?.textContent, formatDateTime('2026-09-06T10:05:00-04:00'));
  });

  it('shows the scene, destination, response and situation with codes and meanings', () => {
    showAls();
    assert.deepEqual(details('Scene / Pickup'), [
      ['Name', '—'],
      ['Address', '2645 N 3rd St, Harrisburg, PA 17110'],
      ['Location Type', 'ICD-10 Y92.531']
    ]);
    assert.deepEqual(details('Destination')[2], [
      'Destination Type',
      'Hospital-Emergency Department 4221003'
    ]);
    assert.deepEqual(details('Response and Disposition').at(-1), [
      'CMS Service Level',
      'ALS, Level 1 Emergency 2650003'
    ]);
    assert.deepEqual(details('Situation')[1], [
      'Primary Impression',
      'Supraventricular tachycardia, unspecified I47.10'
    ]);
  });

  it('tabulates vitals and medications', () => {
    showAls();
    assert.deepEqual(rows('Vital signs')[0], [
      formatDateTime('2026-09-06T10:16:00-04:00'),
      '98/64',
      '212',
      '96%',
      '22',
      '—',
      '15'
    ]);
    assert.deepEqual(rows('Medications given')[0], [
      'Adenosine 296',
      formatDateTime('2026-09-06T10:20:00-04:00'),
      'Intravenous (IV) 9927023',
      '6 Milligrams (mg)'
    ]);
    assert.equal(rows('Medications given').length, 4);
  });

  it('shows the narrative and the loaded miles with the odometer readings', () => {
    showAls();
    assert.equal(
      part('Narrative').querySelector('p')?.textContent,
      readPcr(alsReport, fixtureDictionary).narrative
    );
    assert.deepEqual(details('Odometer'), [
      ['Loaded Miles', '6.86 miles'],
      ['At Scene', '31893'],
      ['At Destination', '31899.86']
    ]);
  });

  it('tabulates procedures when the report has them', () => {
    show({
      eProcedures: {
        'eProcedures.ProcedureGroup': { 'eProcedures.03': '392230005' }
      }
    });
    assert.deepEqual(rows('Procedures performed'), [['SNOMED CT 392230005', '—']]);
  });

  it('notes what a report with nothing recorded is missing', () => {
    show(null);
    assert.deepEqual(
      screen.getAllByText(/^No .* on the report\.$/).map((p) => p.textContent),
      [
        'No insurances on the report.',
        'No vital signs on the report.',
        'No medications on the report.',
        'No procedures on the report.',
        'No narrative on the report.'
      ]
    );
    assert.ok(!screen.queryByRole('table'));
    assert.deepEqual(details('Odometer'), [
      ['Loaded Miles', '—'],
      ['At Scene', '—'],
      ['At Destination', '—']
    ]);
    assert.ok(!part('Times').querySelector('time'));
  });
});
