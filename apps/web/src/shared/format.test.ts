import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatAgo,
  formatCents,
  formatDate,
  formatDateTime,
  formatDuration,
  formatMiles,
  labelFromName,
  parseDollars,
  titleCaseLabel
} from './format.ts';

describe('format', () => {
  it('formats timestamps and durations for display', () => {
    assert.equal(formatDateTime(null), '—');
    assert.ok(formatDateTime('2026-01-02T03:04:05Z').includes('2026'));
    assert.equal(formatDuration(0.2), '<1 ms');
    assert.equal(formatDuration(42.4), '42 ms');
    assert.equal(formatDuration(2500), '2.5 s');
    assert.equal(formatCents(114220), '$1,142.20');
    assert.equal(formatCents(0), '$0.00');
    assert.equal(parseDollars('950.5'), 95050);
    assert.equal(parseDollars('0.29'), 29);
    assert.equal(parseDollars(' '), null);
    assert.equal(parseDollars('-1'), null);
    assert.equal(parseDollars('abc'), null);
  });
});

describe('formatDate', () => {
  it('shows calendar dates without shifting them across time zones', () => {
    assert.match(formatDate('2026-10-01'), /2026/);
    assert.match(formatDate('2026-10-01'), /1/);
    assert.equal(formatDate('2026-01-01'), formatDate('2026-01-01T23:59:00Z'));
    assert.equal(formatDate(null), '—');
  });
});

describe('formatAgo', () => {
  it('says how long ago something happened in the largest whole unit', () => {
    const now = new Date('2026-10-23T12:00:00Z');
    assert.equal(formatAgo('2026-10-23T11:59:40Z', now), 'this minute');
    assert.equal(formatAgo('2026-10-23T11:55:00Z', now), '5 minutes ago');
    assert.equal(formatAgo('2026-10-23T09:30:00Z', now), '2 hours ago');
    assert.equal(formatAgo('2026-10-22T11:00:00Z', now), 'yesterday');
    assert.equal(formatAgo(null, now), '—');
  });
});

describe('formatMiles', () => {
  it('shows unrounded mileage to two decimals', () => {
    assert.equal(formatMiles('4.25'), '4.25 miles');
    assert.equal(formatMiles('12.4'), '12.4 miles');
    assert.equal(formatMiles(1), '1 mile');
    assert.equal(formatMiles('1234.567'), '1,234.57 miles');
    assert.equal(formatMiles('x'), '—');
  });
});

describe('titleCaseLabel', () => {
  it('title cases sentence case labels and keeps acronyms', () => {
    assert.equal(titleCaseLabel('Unit price (dollars)'), 'Unit Price (Dollars)');
    assert.equal(
      titleCaseLabel('ICD-10 diagnoses, primary first'),
      'ICD-10 Diagnoses, Primary First'
    );
    assert.equal(titleCaseLabel('Patient ZIP code'), 'Patient ZIP Code');
    assert.equal(
      titleCaseLabel('Save to the default fee schedule'),
      'Save to the Default Fee Schedule'
    );
  });
});

describe('titleCaseLabel edge cases', () => {
  it('cases hyphenated and slashed words, units and NEMSIS element ids', () => {
    assert.equal(
      titleCaseLabel('On-scene odometer · eResponse.20'),
      'On-Scene Odometer · eResponse.20'
    );
    assert.equal(titleCaseLabel('Incident/patient disposition'), 'Incident/Patient Disposition');
    assert.equal(titleCaseLabel('Patient weight (kg)'), 'Patient Weight (kg)');
    assert.equal(titleCaseLabel('IV/IO doses in the narrative'), 'IV/IO Doses in the Narrative');
    assert.equal(titleCaseLabel('Birth date (YYYY-MM-DD)'), 'Birth Date (YYYY-MM-DD)');
    assert.equal(titleCaseLabel('Close as paid'), 'Close as Paid');
  });
});

describe('labelFromName', () => {
  it('turns identifiers into Title Case labels with acronyms kept upper case', () => {
    assert.equal(labelFromName('payerNotes'), 'Payer Notes');
    assert.equal(labelFromName('pcr'), 'PCR');
    assert.equal(labelFromName('pcrNumber'), 'PCR Number');
    assert.equal(labelFromName('claimId'), 'Claim ID');
    assert.equal(labelFromName('runIds'), 'Run IDs');
    assert.equal(labelFromName('hcpcsCode'), 'HCPCS Code');
    assert.equal(labelFromName('nemsisXml'), 'NEMSIS XML');
    assert.equal(labelFromName('x837'), 'X837');
    assert.equal(labelFromName('build-837p'), 'Build 837P');
    assert.equal(labelFromName('npi'), 'NPI');
    assert.equal(labelFromName('patientZIP'), 'Patient ZIP');
    assert.equal(labelFromName('icdCodes'), 'ICD Codes');
    assert.equal(labelFromName('match-patient'), 'Match Patient');
    assert.equal(labelFromName('totalCents'), 'Total (Cents)');
    assert.equal(labelFromName('timeoutMs'), 'Timeout (ms)');
    assert.equal(labelFromName('weightKg'), 'Weight (kg)');
    assert.equal(labelFromName('item1'), 'Item 1');
    assert.equal(labelFromName('isA'), 'Is A');
    assert.equal(labelFromName('whenTrue'), 'When True');
    assert.equal(labelFromName('by'), 'By');
    assert.equal(labelFromName('statementsToSend'), 'Statements to Send');
  });
});
