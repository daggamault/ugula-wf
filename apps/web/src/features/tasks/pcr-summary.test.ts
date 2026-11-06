import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readPcr } from './pcr-reader.ts';
import { PcrSummaryView } from './pcr-summary.tsx';
import { fixtureDictionary, fixtureReport } from './testing.ts';

const render = (data: Parameters<typeof readPcr>[0]) =>
  renderToStaticMarkup(createElement(PcrSummaryView, { pcr: readPcr(data, fixtureDictionary) }));

describe('PcrSummaryView', () => {
  it('summarizes a report in the sections a biller reads, with each code and its meaning', () => {
    const html = render(fixtureReport('als2-iv-medications.xml'));
    for (const title of [
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
    ]) {
      assert.ok(html.includes(`>${title}</h3>`), title);
    }
    assert.ok(html.includes('Rosalind Quintero'));
    assert.ok(html.includes('330 Market St, Harrisburg (1215162), PA 17101'));
    assert.ok(
      html.includes('Blue Plan') && html.includes('XGB110093422') && html.includes('GRP-10233')
    );
    assert.ok(html.includes('Supraventricular tachycardia (I47.1)'));
    assert.ok(html.includes('Transport by This EMS Unit (This Crew Only)'));
    assert.ok(html.includes('ALS, Level 1 Emergency (2650003)'));
    assert.ok(html.includes('dateTime="2026-09-06T10:05:00-04:00"'));
    assert.ok(html.includes('98/64'));
    assert.ok(html.includes('Adenosine') && html.includes('6 Milligrams (mg)'));
    assert.ok(html.includes('No procedures on the report.'));
    assert.ok(html.includes('Vagal maneuvers failed.'));
    assert.ok(html.includes('6.86 miles'));
    assert.ok(html.includes('Emergency Response (Primary Response Area) (2205001)'));
  });

  it('shows dashes and empty notes for a report with nothing recorded', () => {
    const html = render(null);
    assert.ok(html.includes('No insurances on the report.'));
    assert.ok(html.includes('No vital signs on the report.'));
    assert.ok(html.includes('No narrative on the report.'));
    assert.ok(html.includes('—'));
  });
});
