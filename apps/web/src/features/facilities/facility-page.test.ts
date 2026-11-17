import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import { type ToastInput, ToastProvider } from '../../shared/ui/toast.tsx';
import type { CmsHospital, FacilitiesClient, Facility, FacilityInput } from './client.ts';
import { FacilityPage, fromHospital, hospitalLabel, toFacilityDraft } from './facility-page.tsx';

const sunrise: Facility = {
  id: 'f1',
  name: 'Sunrise SNF',
  address_line: '5 Elm St',
  city: 'Springfield',
  state: 'IL',
  postal_code: '62702',
  phone: '2175550100',
  kind: 'snf',
  has_contract: true,
  contract_note: 'Pays all 911',
  balance_cents: 0
};

const southeast: CmsHospital = {
  ccn: '010001',
  name: 'SOUTHEAST HEALTH MEDICAL CENTER',
  address_line: '1108 ROSS CLARK CIRCLE',
  city: 'DOTHAN',
  state: 'AL',
  postal_code: '36301',
  phone: '3347938701',
  hospital_type: 'Acute Care Hospitals'
};

const fakeClient = (over: Partial<FacilitiesClient> = {}) => {
  const read: string[] = [];
  const saved: [string | null, FacilityInput][] = [];
  const searched: string[] = [];
  const client = {
    facility: async (id: string) => {
      read.push(id);
      return sunrise;
    },
    save: async (id: string | null, input: FacilityInput) => {
      saved.push([id, input]);
      return { id: id ?? 'f9' };
    },
    hospitals: async (q: string) => {
      searched.push(q);
      return [southeast];
    },
    ...over
  } as FacilitiesClient;
  return { client, read, saved, searched };
};

const show = (client: FacilitiesClient, facilityId: string | null) => {
  window.history.replaceState(
    null,
    '',
    facilityId ? `/facilities/${facilityId}` : '/facilities/new'
  );
  const toasts: ToastInput[] = [];
  render(
    createElement(
      ToastProvider,
      { onNotify: (t) => toasts.push(t) },
      createElement(FacilityPage, { client, live: idleLive, facilityId, back: '/facilities?q=sun' })
    )
  );
  return toasts;
};

const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;

const FIELDS = ['Facility Name', 'Street Address', 'City', 'State', 'ZIP Code', 'Phone'];

const fieldValues = () => [...FIELDS, 'Contract Note'].map((name) => field(name).value);

const chosen = (list: string) =>
  within(screen.getByRole('listbox', { name: list, hidden: true })).getByRole('option', {
    selected: true,
    hidden: true
  }).textContent;

const choose = (user: ReturnType<typeof userEvent.setup>, list: string, option: string) =>
  user.click(
    within(screen.getByRole('listbox', { name: list, hidden: true })).getByRole('option', {
      name: option,
      hidden: true
    })
  );

const save = () => screen.getByRole('button', { name: 'Save Facility' });

describe('FacilityPage', () => {
  it('starts a new facility blank, as an uncontracted other facility', () => {
    const { client, read } = fakeClient();
    show(client, null);
    assert.ok(screen.getByRole('heading', { name: 'Add Facility', level: 1 }));
    assert.equal(
      screen.getByRole('link', { name: 'Back to Facilities' }).getAttribute('href'),
      '/facilities?q=sun'
    );
    assert.equal(
      screen.getByRole('link', { name: 'Cancel' }).getAttribute('href'),
      '/facilities?q=sun'
    );
    assert.deepEqual(fieldValues(), ['', '', '', '', '', '', '']);
    assert.equal(chosen('Kind'), 'Other facility');
    assert.equal(chosen('Contract'), 'No: its patients’ payers are billed');
    assert.deepEqual(read, []);
  });

  it('adds a facility from what was typed and returns to the list', async () => {
    const { client, saved } = fakeClient();
    const toasts = show(client, null);
    const user = userEvent.setup();
    await user.type(field('Facility Name'), 'Mercy Hospital');
    await user.type(field('City'), 'Peoria');
    await user.type(field('Phone'), '3095550100');
    await choose(user, 'Kind', 'Hospital');
    await choose(user, 'Contract', 'Yes: the facility pays for its transports');
    await user.type(field('Contract Note'), 'Interfacility only');
    await user.click(save());
    await waitFor(() => assert.deepEqual(toasts, [{ title: 'Mercy Hospital saved' }]));
    assert.deepEqual(saved, [
      [
        null,
        {
          name: 'Mercy Hospital',
          addressLine: null,
          city: 'Peoria',
          state: null,
          postalCode: null,
          phone: '3095550100',
          kind: 'hospital',
          hasContract: true,
          contractNote: 'Interfacility only'
        }
      ]
    ]);
    assert.equal(`${window.location.pathname}${window.location.search}`, '/facilities?q=sun');
  });

  it('fills a new facility from a CMS hospital, keeping its contract terms', async () => {
    const { client, saved, searched } = fakeClient();
    show(client, null);
    const user = userEvent.setup();
    await choose(user, 'Contract', 'Yes: the facility pays for its transports');
    await user.type(
      screen.getByRole('combobox', { name: 'Search Fill From CMS Hospital', hidden: true }),
      'southeast'
    );
    const list = screen.getByRole('listbox', { name: 'Fill From CMS Hospital', hidden: true });
    const option = await within(list).findByRole('option', {
      name: 'SOUTHEAST HEALTH MEDICAL CENTER, DOTHAN AL (010001)',
      hidden: true
    });
    assert.deepEqual(searched, ['southeast']);
    await user.click(option);
    assert.deepEqual(fieldValues(), [
      'SOUTHEAST HEALTH MEDICAL CENTER',
      '1108 ROSS CLARK CIRCLE',
      'DOTHAN',
      'AL',
      '36301',
      '3347938701',
      ''
    ]);
    assert.equal(chosen('Kind'), 'Hospital');
    assert.equal(chosen('Contract'), 'Yes: the facility pays for its transports');
    await user.click(save());
    await waitFor(() => assert.equal(saved.length, 1));
    assert.equal(saved[0]?.[1].hasContract, true);
  });

  it('opens a facility with its details and no hospital picker', async () => {
    const { client, read } = fakeClient();
    show(client, 'f1');
    assert.ok(await screen.findByRole('heading', { name: 'Sunrise SNF', level: 1 }));
    assert.deepEqual(fieldValues(), [
      'Sunrise SNF',
      '5 Elm St',
      'Springfield',
      'IL',
      '62702',
      '2175550100',
      'Pays all 911'
    ]);
    assert.equal(chosen('Kind'), 'Skilled nursing facility');
    assert.equal(chosen('Contract'), 'Yes: the facility pays for its transports');
    assert.ok(!screen.queryByRole('listbox', { name: 'Fill From CMS Hospital', hidden: true }));
    assert.deepEqual(read, ['f1']);
  });

  it('updates a facility in place, clearing emptied fields', async () => {
    const { client, saved } = fakeClient();
    const toasts = show(client, 'f1');
    await screen.findByRole('heading', { name: 'Sunrise SNF', level: 1 });
    const user = userEvent.setup();
    await user.clear(field('Phone'));
    await user.clear(field('Contract Note'));
    await user.click(save());
    await waitFor(() => assert.deepEqual(toasts, [{ title: 'Sunrise SNF saved' }]));
    assert.deepEqual(saved, [
      [
        'f1',
        {
          name: 'Sunrise SNF',
          addressLine: '5 Elm St',
          city: 'Springfield',
          state: 'IL',
          postalCode: '62702',
          phone: null,
          kind: 'snf',
          hasContract: true,
          contractNote: null
        }
      ]
    ]);
  });

  it('says why a facility could not be saved and stays on the form', async () => {
    const { client } = fakeClient({
      save: async () => {
        throw new Error('Name is taken');
      }
    });
    const toasts = show(client, 'f1');
    await screen.findByRole('heading', { name: 'Sunrise SNF', level: 1 });
    await userEvent.setup().click(save());
    assert.equal((await screen.findByRole('alert')).textContent, 'Name is taken');
    assert.deepEqual(toasts, []);
    assert.equal(window.location.pathname, '/facilities/f1');
    assert.equal(save().hasAttribute('disabled'), false);
  });

  it('says why the facility could not be opened', async () => {
    const { client } = fakeClient({
      facility: async () => {
        throw new Error('Facility not found');
      }
    });
    show(client, 'f1');
    assert.ok(await screen.findByRole('heading', { name: 'Something Went Wrong' }));
    assert.ok(screen.getByText('Facility not found'));
  });
});

describe('toFacilityDraft', () => {
  it('copies a stored facility into an editable draft', () => {
    assert.deepEqual(toFacilityDraft(sunrise), {
      name: 'Sunrise SNF',
      addressLine: '5 Elm St',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62702',
      phone: '2175550100',
      kind: 'snf',
      hasContract: true,
      contractNote: 'Pays all 911'
    });
  });
});

describe('fromHospital', () => {
  it('names a hospital by its city, state and CCN', () => {
    assert.equal(hospitalLabel(southeast), 'SOUTHEAST HEALTH MEDICAL CENTER, DOTHAN AL (010001)');
  });

  it('keeps the typed phone when the hospital lists none', () => {
    const draft = { ...toFacilityDraft(null), phone: '2175550100' };
    assert.equal(fromHospital(draft, { ...southeast, phone: null }).phone, '2175550100');
  });
});
