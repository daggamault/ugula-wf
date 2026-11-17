import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, within } from '../testing-dom.ts';
import type { ClaimCoverage } from './claim-detail.ts';
import { coverageIds, insuredText, PayersPanel } from './claim-payers.tsx';

const coverage = (over: Partial<ClaimCoverage> = {}): ClaimCoverage => ({
  id: 'c',
  position: 1,
  payer: 'Medicare',
  payer_id: 'p1',
  payer_code: null,
  member_id: '1EG4',
  group_id: null,
  relationship: '18',
  insured_first_name: null,
  insured_last_name: null,
  eligibility: null,
  eligibility_note: null,
  eligibility_checked_at: null,
  stay_kind: null,
  stay_admitted_on: null,
  stay_discharged_on: null,
  ...over
});

const spouse = coverage({
  id: 'b',
  payer: 'Blue Plan',
  payer_id: null,
  member_id: null,
  group_id: 'G7',
  relationship: '01',
  insured_first_name: 'John',
  insured_last_name: 'Doe'
});

describe('coverageIds', () => {
  it('writes the member ID and group', () => {
    assert.equal(coverageIds(coverage({ group_id: 'G7' })), 'Member ID 1EG4 · group G7');
    assert.equal(coverageIds(coverage()), 'Member ID 1EG4');
  });

  it('says when the member ID is missing', () => {
    assert.equal(coverageIds(coverage({ member_id: null })), 'No member ID');
    assert.equal(coverageIds(spouse), 'No member ID · group G7');
  });
});

describe('insuredText', () => {
  it('says the patient is the insured', () => {
    assert.equal(insuredText(coverage()), 'Patient is the insured');
  });

  it('names someone else insured and how the patient relates to them', () => {
    assert.equal(insuredText(spouse), 'Insured: John Doe (patient is the spouse)');
    assert.equal(
      insuredText(
        coverage({ relationship: '19', insured_first_name: null, insured_last_name: 'Doe' })
      ),
      'Insured: Doe (patient is the child)'
    );
  });

  it('says when the name of the insured is missing', () => {
    assert.equal(
      insuredText(coverage({ relationship: '01' })),
      'Insured: name missing (patient is the spouse)'
    );
  });
});

describe('PayersPanel', () => {
  it('lists the payers in billing order with their IDs and insured', () => {
    render(createElement(PayersPanel, { coverages: [coverage(), spouse] }));
    const panel = screen.getByRole('region', { name: 'Payers' });
    assert.ok(
      within(panel).getByText('Billed in this order, with the patient billed after the last payer.')
    );
    assert.deepEqual(
      within(within(panel).getByRole('list'))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
      [
        '11. MedicareMember ID 1EG4 · Patient is the insured',
        '22. Blue PlanNot in Payer DirectoryNo member ID · group G7 · Insured: John Doe (patient is the spouse)'
      ]
    );
  });

  it('links a payer missing from the directory to the directory', () => {
    render(createElement(PayersPanel, { coverages: [coverage(), spouse] }));
    const links = screen.getAllByRole('link');
    assert.deepEqual(
      links.map((a) => [a.textContent, a.getAttribute('href')]),
      [['Not in Payer Directory', '/payers']]
    );
  });

  it('says when the patient is billed directly', () => {
    render(createElement(PayersPanel, { coverages: [] }));
    assert.ok(screen.getByText('No payers yet. The patient will be billed directly.'));
    assert.ok(!screen.queryByRole('list'));
  });
});
