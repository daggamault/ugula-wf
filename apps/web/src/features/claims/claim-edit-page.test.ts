import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { claimDetail as claim } from '../../shared/claims/testing.ts';
import { render, screen, userEvent, waitFor } from '../../shared/testing-dom.ts';
import { ClaimForm, toClaimDraft, toClaimEdit } from './claim-edit-page.tsx';
import type { ClaimEdit } from './client.ts';

describe('toClaimEdit', () => {
  it('turns the claim as shown into the same claim to save', () => {
    const edit = toClaimEdit(toClaimDraft(claim), claim.revision);
    assert.ok(typeof edit !== 'string');
    assert.equal(edit.revision, 1);
    assert.deepEqual(
      [edit.serviceDate, edit.level, edit.emergency, edit.loadedMiles, edit.weightPounds],
      ['2026-10-01', 'ALS1', true, 12.4, 180]
    );
    assert.deepEqual(edit.diagnoses, claim.diagnoses);
    assert.deepEqual(edit.lines[0], {
      code: 'A0427',
      modifiers: ['RH'],
      units: 1,
      unitCents: 95_000
    });
    assert.deepEqual(edit.coverages[0], {
      payerId: 'p-m',
      payerName: 'Medicare',
      memberId: '1EG4',
      groupId: null,
      relationship: '18',
      insuredFirstName: null,
      insuredLastName: null
    });
    assert.deepEqual(edit.pickup, {
      name: null,
      line: '9 Elm St',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62704'
    });
    assert.equal(edit.patient.sex, 'F');
  });

  it('reads codes in any case and spacing, and blanks as nothing', () => {
    const draft = toClaimDraft(claim);
    const edit = toClaimEdit(
      {
        ...draft,
        diagnoses: 'r07.9,  i10 ',
        loadedMiles: ' ',
        note: '  ',
        lines: [{ key: 'k', code: ' a0428 ', modifiers: 'rh  ql', units: '1', price: '450' }]
      },
      3
    );
    assert.ok(typeof edit !== 'string');
    assert.deepEqual([edit.diagnoses, edit.loadedMiles, edit.note], [['R07.9', 'I10'], null, null]);
    assert.deepEqual(edit.lines, [
      { code: 'A0428', modifiers: ['RH', 'QL'], units: 1, unitCents: 45_000 }
    ]);
  });

  it('says what to fix before sending', () => {
    const draft = toClaimDraft(claim);
    const line = { key: 'k', code: 'A0427', modifiers: '', units: '1', price: '1' };
    assert.equal(
      toClaimEdit({ ...draft, weightPounds: '180.5' }, 1),
      'Enter the weight in whole pounds.'
    );
    assert.equal(
      toClaimEdit({ ...draft, loadedMiles: '-1' }, 1),
      'Enter loaded miles of zero or more.'
    );
    assert.equal(
      toClaimEdit({ ...draft, lines: [{ ...line, units: '0' }] }, 1),
      'Enter the units of line 1.'
    );
    assert.equal(
      toClaimEdit({ ...draft, lines: [{ ...line, price: 'x' }] }, 1),
      'Enter the unit price of line 1.'
    );
  });
});

const show = (onSave: (edit: ClaimEdit) => Promise<string | null>) =>
  render(
    createElement(ClaimForm, {
      claim,
      findPayers: async () => [{ id: 'p-b', name: 'Blue Plan' }],
      back: '/claims/c1',
      onSave
    })
  );

describe('ClaimForm', () => {
  it('saves the corrected claim, and shows why the server refused it', async () => {
    const saved: ClaimEdit[] = [];
    show(async (edit) => {
      saved.push(edit);
      return 'The claim changed since you opened it.';
    });
    const user = userEvent.setup();
    const note = screen.getByRole('textbox', { name: 'Claim Note' });
    await user.type(note, 'Bed confined');
    await user.click(screen.getByRole('button', { name: 'Remove Line 1' }));
    await user.click(screen.getByRole('button', { name: 'Save Claim' }));
    await waitFor(() => assert.equal(saved.length, 1));
    assert.equal(saved[0]?.note, 'Bed confined');
    assert.equal(saved[0]?.lines.length, claim.lines.length - 1);
    assert.ok(await screen.findByText('The claim changed since you opened it.'));
  });

  it('adds a payer and a line to fill in, and asks for the insured only when it is not the patient', async () => {
    show(async () => null);
    const user = userEvent.setup();
    const payers = claim.coverages.length;
    await user.click(screen.getByRole('button', { name: 'Add Payer' }));
    assert.ok(screen.getByRole('region', { name: `Payer ${payers + 1}` }));
    assert.equal(screen.queryAllByRole('textbox', { name: 'Insured Last Name' }).length, 1);
    await user.click(screen.getByRole('button', { name: 'Add Line' }));
    assert.ok(screen.getByRole('region', { name: `Line ${claim.lines.length + 1}` }));
  });
});
