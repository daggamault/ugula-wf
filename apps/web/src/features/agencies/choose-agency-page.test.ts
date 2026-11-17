import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import type { Agency } from '../../shared/access.tsx';
import { render, screen, userEvent, within } from '../../shared/testing-dom.ts';
import { ChooseAgencyPage } from './choose-agency-page.tsx';

const NORTH = '0b7e6a52-3c1d-4f8e-9a2b-5d6c7e8f9a0b';
const SOUTH = '1c8f7b63-4d2e-4a9f-8b3c-6e7d8f9a0b1c';

const agencies: Agency[] = [
  { id: NORTH, name: 'North EMS', organizationId: 'o1', organizationName: 'Acme' },
  { id: SOUTH, name: 'South EMS', organizationId: 'o2', organizationName: 'Bolt' }
];

const show = (list: readonly Agency[], notice?: string) => {
  let signedOut = 0;
  render(
    createElement(ChooseAgencyPage, {
      agencies: list,
      notice,
      onSignOut: () => {
        signedOut++;
      }
    })
  );
  return { signedOut: () => signedOut };
};

describe('ChooseAgencyPage', () => {
  it('lists each agency with its organization, linked to the agency root', () => {
    show(agencies);
    const card = screen.getByRole('region', { name: 'Choose an Agency' });
    const links = within(card).getAllByRole('link');
    assert.deepEqual(
      links.map((l) => [l.textContent, l.getAttribute('href')]),
      [
        ['North EMSAcme', `/agencies/${NORTH}`],
        ['South EMSBolt', `/agencies/${SOUTH}`]
      ]
    );
  });

  it('opens the chosen agency without reloading the page', async () => {
    show(agencies);
    await userEvent.setup().click(screen.getByRole('link', { name: 'South EMS Bolt' }));
    assert.equal(window.location.pathname, `/agencies/${SOUTH}`);
  });

  it('shows no notice and no empty message when there are agencies', () => {
    show(agencies);
    assert.ok(!screen.queryByRole('status'));
    assert.ok(!screen.queryByText(/Ask an administrator/));
  });

  it('explains an empty list', () => {
    show([]);
    assert.ok(!screen.queryByRole('list'));
    assert.ok(
      screen.getByText(
        'You do not have access to any agency yet. Ask an administrator to invite you.'
      )
    );
  });

  it('warns why the last agency was refused', () => {
    show(agencies, 'You cannot open that agency. Choose another.');
    assert.equal(
      screen.getByRole('status').textContent,
      'You cannot open that agency. Choose another.'
    );
  });

  it('signs out', async () => {
    const { signedOut } = show(agencies);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign Out' }));
    assert.equal(signedOut(), 1);
  });
});
