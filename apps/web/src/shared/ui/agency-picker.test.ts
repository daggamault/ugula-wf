import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import type { Agency } from '../access.tsx';
import { act, render, screen, userEvent, within } from '../testing-dom.ts';
import { AgencyPicker } from './agency-picker.tsx';

const agency = (i: number, organizationName = 'Acme'): Agency => ({
  id: `a${i}`,
  name: `Agency ${i}`,
  organizationId: 'o1',
  organizationName
});

const show = (agencies: Agency[]) => {
  render(
    createElement(AgencyPicker, {
      agencies,
      current: { id: 'a1', name: 'Agency 1', organizationName: 'Acme' }
    })
  );
  const panel = screen.getByRole('dialog', { name: 'Agencies', hidden: true });
  const choiceButtons = () => within(panel).queryAllByRole('button', { hidden: true });
  const choices = () => choiceButtons().map((b) => b.textContent);
  const open = () => act(() => panel.showPopover());
  const trigger = screen.getByRole('button', { name: /Switch agency/ });
  return { panel, choiceButtons, choices, open, trigger, user: userEvent.setup() };
};

describe('AgencyPicker', () => {
  it('names the trigger by the current agency and its organization', () => {
    const { trigger } = show([agency(1), agency(2)]);
    assert.equal(trigger.textContent, 'Agency 1AcmeSwitch agency');
    assert.equal(trigger.hasAttribute('disabled'), false);
  });

  it('locks the trigger when there is nowhere to switch to', () => {
    const { trigger } = show([agency(1)]);
    assert.equal(trigger.hasAttribute('disabled'), true);
  });

  it('targets the agency list popover from the trigger', () => {
    const { trigger, panel } = show([agency(1), agency(2)]);
    assert.equal(trigger.getAttribute('popovertarget'), panel.id);
    assert.equal(panel.getAttribute('popover'), 'auto');
  });

  it('lists every agency and marks only the current one', () => {
    const { choices, choiceButtons, panel } = show([agency(1), agency(2)]);
    assert.deepEqual(choices(), ['Agency 1Acme', 'Agency 2Acme']);
    assert.deepEqual(
      choiceButtons().map((b) => b.getAttribute('aria-current')),
      ['true', null]
    );
    assert.ok(!panel.querySelector('input'));
  });

  it('switches to another agency and closes the list', async () => {
    const { panel, open, user } = show([agency(1), agency(2)]);
    open();
    await user.click(within(panel).getByRole('button', { name: 'Agency 2 Acme' }));
    assert.equal(window.location.pathname, '/agencies/a2');
    assert.equal(panel.matches(':popover-open'), false);
  });

  it('closes without navigating when the current agency is chosen', async () => {
    const { panel, open, user } = show([agency(1), agency(2)]);
    open();
    await user.click(within(panel).getByRole('button', { name: 'Agency 1 Acme' }));
    assert.equal(window.location.pathname, '/');
    assert.equal(panel.matches(':popover-open'), false);
  });

  it('offers no search for six agencies or fewer', () => {
    const { panel } = show([1, 2, 3, 4, 5, 6].map((i) => agency(i)));
    assert.ok(!panel.querySelector('input'));
  });

  it('filters by agency or organization name, ignoring case and surrounding spaces', async () => {
    const { panel, choices, open, user } = show([
      ...[1, 2, 3, 4, 5, 6].map((i) => agency(i)),
      agency(7, 'Bayside')
    ]);
    open();
    const search = within(panel).getByRole('searchbox', { name: 'Find an Agency' });
    assert.equal(search.getAttribute('placeholder'), 'Find an Agency');
    await user.type(search, ' BAYSIDE ');
    assert.deepEqual(choices(), ['Agency 7Bayside']);
    await user.clear(search);
    await user.type(search, 'agency 1');
    assert.deepEqual(choices(), ['Agency 1Acme']);
    await user.type(search, 'x');
    assert.deepEqual(choices(), []);
  });
});
