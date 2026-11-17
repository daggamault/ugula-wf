import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  browserTimeZone,
  formatAgo,
  formatCents,
  formatDate,
  formatDateTime,
  formatDay,
  formatDollars,
  formatDuration,
  formatMiles,
  formatMonth,
  labelFromName,
  labelOf,
  parseDollars,
  patientName,
  sexLabel,
  titleCaseLabel,
  titleCaseWords
} from './format.ts';

describe('formatDateTime', () => {
  it('shows a timestamp as a medium date and short time in the local zone', () => {
    const at = '2026-01-02T03:04:05Z';
    assert.equal(
      formatDateTime(at),
      new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    );
  });

  it('shows a dash for a missing timestamp', () => {
    assert.equal(formatDateTime(null), '—');
  });
});

describe('formatDay', () => {
  it('shows the local day of a timestamp without the time', () => {
    assert.equal(formatDay('2026-01-02T12:00:00Z'), 'Jan 2, 2026');
  });

  it('shows a dash for a missing timestamp', () => {
    assert.equal(formatDay(null), '—');
  });
});

describe('formatDate', () => {
  it('shows a calendar date without shifting it across time zones', () => {
    assert.equal(formatDate('2026-10-01'), 'Oct 1, 2026');
  });

  it('uses only the date part of a timestamp', () => {
    assert.equal(formatDate('2026-01-01T23:59:00-08:00'), 'Jan 1, 2026');
  });

  it('shows a dash for a missing date', () => {
    assert.equal(formatDate(null), '—');
  });
});

describe('formatMonth', () => {
  it('names the month and year of a month or of a day in it', () => {
    assert.equal(formatMonth('2026-10'), 'October 2026');
    assert.equal(formatMonth('2026-01'), 'January 2026');
    assert.equal(formatMonth('2026-12-01'), 'December 2026');
  });
});

describe('browserTimeZone', () => {
  it('names the time zone the browser resolves', () => {
    assert.equal(browserTimeZone(), Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});

describe('formatDuration', () => {
  it('shows durations under a millisecond as <1 ms', () => {
    assert.equal(formatDuration(0), '<1 ms');
    assert.equal(formatDuration(0.2), '<1 ms');
  });

  it('shows durations under a second in whole milliseconds', () => {
    assert.equal(formatDuration(1), '1 ms');
    assert.equal(formatDuration(42.4), '42 ms');
    assert.equal(formatDuration(999), '999 ms');
  });

  it('shows durations of a second or more in seconds to one decimal', () => {
    assert.equal(formatDuration(1000), '1.0 s');
    assert.equal(formatDuration(2500), '2.5 s');
  });
});

describe('formatCents', () => {
  it('shows cents as US dollars with separators', () => {
    assert.equal(formatCents(114_220), '$1,142.20');
    assert.equal(formatCents(5), '$0.05');
    assert.equal(formatCents(0), '$0.00');
    assert.equal(formatCents(-2_500), '-$25.00');
  });
});

describe('formatDollars', () => {
  it('writes cents as plain dollar amounts', () => {
    assert.equal(formatDollars(114_220), '1142.20');
    assert.equal(formatDollars(5), '0.05');
    assert.equal(formatDollars(0), '0.00');
    assert.equal(formatDollars(-2_500), '-25.00');
  });
});

describe('parseDollars', () => {
  it('reads dollar text as whole cents', () => {
    assert.equal(parseDollars('950.5'), 95_050);
    assert.equal(parseDollars('0.29'), 29);
    assert.equal(parseDollars(' 12 '), 1_200);
    assert.equal(parseDollars('0'), 0);
  });

  it('rounds fractions of a cent half up, exactly as written', () => {
    assert.equal(parseDollars('1.236'), 124);
    assert.equal(parseDollars('1.234'), 123);
    assert.equal(parseDollars('1.005'), 101);
    assert.equal(parseDollars('8.675'), 868);
  });

  it('rejects blank, negative and non-numeric text', () => {
    assert.equal(parseDollars(''), null);
    assert.equal(parseDollars(' '), null);
    assert.equal(parseDollars('-1'), null);
    assert.equal(parseDollars('abc'), null);
    assert.equal(parseDollars('Infinity'), null);
  });
});

describe('formatMiles', () => {
  it('shows mileage to at most two decimals with separators', () => {
    assert.equal(formatMiles('4.25'), '4.25 miles');
    assert.equal(formatMiles('12.4'), '12.4 miles');
    assert.equal(formatMiles('1234.567'), '1,234.57 miles');
  });

  it('uses the singular for exactly one mile', () => {
    assert.equal(formatMiles(1), '1 mile');
    assert.equal(formatMiles('1.0'), '1 mile');
    assert.equal(formatMiles(0), '0 miles');
  });

  it('shows a dash for text that is not a number', () => {
    assert.equal(formatMiles('x'), '—');
  });
});

describe('formatAgo', () => {
  const now = new Date('2026-10-23T12:00:00Z');

  it('says this minute for less than a minute ago', () => {
    assert.equal(formatAgo('2026-10-23T11:59:40Z', now), 'this minute');
  });

  it('says how long ago something happened in the largest whole unit', () => {
    assert.equal(formatAgo('2026-10-23T11:55:00Z', now), '5 minutes ago');
    assert.equal(formatAgo('2026-10-23T09:30:00Z', now), '2 hours ago');
    assert.equal(formatAgo('2026-10-22T11:00:00Z', now), 'yesterday');
    assert.equal(formatAgo('2026-10-20T11:00:00Z', now), '3 days ago');
  });

  it('switches unit exactly at the unit boundary', () => {
    assert.equal(formatAgo('2026-10-23T11:00:00Z', now), '1 hour ago');
    assert.equal(formatAgo('2026-10-23T11:00:01Z', now), '59 minutes ago');
  });

  it('shows a dash for a missing time', () => {
    assert.equal(formatAgo(null, now), '—');
  });
});

describe('titleCaseLabel', () => {
  it('title cases sentence case labels', () => {
    assert.equal(titleCaseLabel('Unit price (dollars)'), 'Unit Price (Dollars)');
    assert.equal(
      titleCaseLabel('ICD-10 diagnoses, primary first'),
      'ICD-10 Diagnoses, Primary First'
    );
  });

  it('keeps known acronyms upper case', () => {
    assert.equal(titleCaseLabel('Patient zip code'), 'Patient ZIP Code');
    assert.equal(titleCaseLabel('npi of the pcr'), 'NPI of the PCR');
  });

  it('keeps minor words lower case except as the first or last word', () => {
    assert.equal(
      titleCaseLabel('Save to the default fee schedule'),
      'Save to the Default Fee Schedule'
    );
    assert.equal(titleCaseLabel('Close as paid'), 'Close as Paid');
    assert.equal(titleCaseLabel('of the payer'), 'Of the Payer');
    assert.equal(titleCaseLabel('Statements to send to'), 'Statements to Send To');
  });

  it('cases each part of hyphenated and slashed words', () => {
    assert.equal(titleCaseLabel('On-scene odometer'), 'On-Scene Odometer');
    assert.equal(titleCaseLabel('Incident/patient disposition'), 'Incident/Patient Disposition');
    assert.equal(titleCaseLabel('IV/IO doses in the narrative'), 'IV/IO Doses in the Narrative');
  });

  it('keeps lower case units and mixed case element ids', () => {
    assert.equal(titleCaseLabel('Patient weight (kg)'), 'Patient Weight (kg)');
    assert.equal(titleCaseLabel('Odometer · eResponse.20'), 'Odometer · eResponse.20');
    assert.equal(titleCaseLabel('Birth date (YYYY-MM-DD)'), 'Birth Date (YYYY-MM-DD)');
  });
});

describe('titleCaseWords', () => {
  it('title cases words of any case as one label', () => {
    assert.equal(titleCaseWords(['SEND', 'to', 'Collections']), 'Send to Collections');
    assert.equal(titleCaseWords(['npi', 'number']), 'NPI Number');
  });
});

describe('labelFromName', () => {
  it('splits camelCase, dashed and underscored names into Title Case words', () => {
    assert.equal(labelFromName('payerNotes'), 'Payer Notes');
    assert.equal(labelFromName('match-patient'), 'Match Patient');
    assert.equal(labelFromName('first_name.value'), 'First Name Value');
    assert.equal(labelFromName('statementsToSend'), 'Statements to Send');
    assert.equal(labelFromName('isA'), 'Is A');
    assert.equal(labelFromName('by'), 'By');
  });

  it('keeps acronyms upper case', () => {
    assert.equal(labelFromName('pcr'), 'PCR');
    assert.equal(labelFromName('pcrNumber'), 'PCR Number');
    assert.equal(labelFromName('claimId'), 'Claim ID');
    assert.equal(labelFromName('runIds'), 'Run IDs');
    assert.equal(labelFromName('hcpcsCode'), 'HCPCS Code');
    assert.equal(labelFromName('nemsisXml'), 'NEMSIS XML');
    assert.equal(labelFromName('patientZIP'), 'Patient ZIP');
    assert.equal(labelFromName('icdCodes'), 'ICD Codes');
    assert.equal(labelFromName('XMLParser'), 'XML Parser');
  });

  it('splits a trailing number from a word but keeps coded names whole', () => {
    assert.equal(labelFromName('item1'), 'Item 1');
    assert.equal(labelFromName('x837'), 'X837');
    assert.equal(labelFromName('build-837p'), 'Build 837P');
  });

  it('puts a trailing unit in parentheses', () => {
    assert.equal(labelFromName('totalCents'), 'Total (Cents)');
    assert.equal(labelFromName('timeoutMs'), 'Timeout (ms)');
    assert.equal(labelFromName('weightKg'), 'Weight (kg)');
  });

  it('does not treat a unit alone as a suffix', () => {
    assert.equal(labelFromName('cents'), 'Cents');
  });

  it('gives back a name with no words as it is', () => {
    assert.equal(labelFromName('--'), '--');
    assert.equal(labelFromName(''), '');
  });
});

describe('patientName', () => {
  it('joins last and first names', () => {
    assert.equal(patientName('Doe', 'Jane'), 'Doe, Jane');
  });

  it('leaves out a missing first name without a stray separator', () => {
    assert.equal(patientName('Doe', null), 'Doe');
    assert.equal(patientName('Doe', ''), 'Doe');
  });

  it('gives no name without a last name', () => {
    assert.equal(patientName(null, 'Jane'), null);
    assert.equal(patientName('', 'Jane'), null);
  });
});

describe('sexLabel', () => {
  it('names a known sex code', () => {
    assert.equal(sexLabel('F'), 'Female');
    assert.equal(sexLabel('M'), 'Male');
  });

  it('names nothing for an unknown or missing code', () => {
    assert.equal(sexLabel('X'), null);
    assert.equal(sexLabel(null), null);
  });
});

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
