import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import { type ToastInput, ToastProvider } from '../../shared/ui/toast.tsx';
import type { Payer, PayerInput, PayersClient } from './client.ts';
import { PayerPage, payerSavedNotice, toPayerDraft } from './payer-page.tsx';

const medicare: Payer = {
  id: 'p1',
  name: 'Medicare',
  payer_code: '00952',
  claim_filing: 'MB',
  filing_limit_days: null,
  correction_method: null,
  appeal_days: null,
  plan_type: null,
  is_searchable: false,
  aliases: [{ id: 'a1', alias: 'MCR Part B' }]
};

const fakeClient = (over: Partial<PayersClient> = {}) => {
  const read: string[] = [];
  const saved: PayerInput[] = [];
  const removed: string[] = [];
  const forgotten: [string, string][] = [];
  const client = {
    payer: async (id: string) => {
      read.push(id);
      return medicare;
    },
    save: async (input: PayerInput) => {
      saved.push(input);
      return { payer: { ...medicare, name: input.name }, linkedClaims: 2 };
    },
    remove: async (id: string) => {
      removed.push(id);
      return { id };
    },
    forgetAlias: async (payerId: string, aliasId: string) => {
      forgotten.push([payerId, aliasId]);
      return { id: aliasId };
    },
    ...over
  } as PayersClient;
  return { client, read, saved, removed, forgotten };
};

const show = (client: PayersClient, payerId: string | null) => {
  const toasts: ToastInput[] = [];
  render(
    createElement(
      ToastProvider,
      { onNotify: (t) => toasts.push(t) },
      createElement(PayerPage, { client, live: idleLive, payerId, back: '/payers?q=part' })
    )
  );
  return toasts;
};

const textbox = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;

const days = (name: string) => screen.getByRole('spinbutton', { name }) as HTMLInputElement;

const trigger = (name: string) => screen.getByRole('button', { name });

const choose = async (user: ReturnType<typeof userEvent.setup>, list: string, option: string) =>
  user.click(
    within(screen.getByRole('listbox', { name: list })).getByRole('option', { name: option })
  );

const form = () => screen.findByRole('form', { name: 'Save Payer' });

const here = () => `${window.location.pathname}${window.location.search}`;

describe('toPayerDraft', () => {
  it('starts a new payer as commercial insurance with no limits', () => {
    assert.deepEqual(toPayerDraft(null), {
      name: '',
      payerCode: '',
      claimFiling: 'CI',
      filingLimitDays: null,
      correctionMethod: null,
      appealDays: null,
      planType: null,
      isSearchable: false
    });
  });

  it('copies every setting of a saved payer', () => {
    assert.deepEqual(
      toPayerDraft({
        ...medicare,
        filing_limit_days: 365,
        correction_method: 'reopening',
        appeal_days: 120,
        plan_type: 'government',
        is_searchable: true
      }),
      {
        name: 'Medicare',
        payerCode: '00952',
        claimFiling: 'MB',
        filingLimitDays: 365,
        correctionMethod: 'reopening',
        appealDays: 120,
        planType: 'government',
        isSearchable: true
      }
    );
  });
});

describe('payerSavedNotice', () => {
  it('says how many claims a saved payer was linked to', () => {
    assert.equal(payerSavedNotice('Medicare', 0), 'Medicare saved');
    assert.equal(payerSavedNotice('Medicare', 1), 'Medicare saved and linked to 1 claim');
    assert.equal(payerSavedNotice('Medicare', 3), 'Medicare saved and linked to 3 claims');
  });
});

describe('PayerPage', () => {
  it('shows a spinner until the payer loads', () => {
    show({ payer: () => new Promise<never>(() => undefined) } as unknown as PayersClient, 'p1');
    assert.ok(screen.getByLabelText('Loading'));
    assert.ok(!screen.queryByRole('form', { name: 'Save Payer' }));
  });

  it('opens a payer with its settings, a read-only name and a way back', async () => {
    const { client, read } = fakeClient();
    show(client, 'p1');
    await form();
    assert.ok(screen.getByRole('heading', { name: 'Medicare', level: 1 }));
    assert.deepEqual(read, ['p1']);
    assert.equal(textbox('Payer Name').value, 'Medicare');
    assert.equal(textbox('Payer Name').readOnly, true);
    assert.ok(screen.getByText('To rename a payer, add it again under the new name.'));
    assert.equal(textbox('Clearinghouse Payer ID').value, '00952');
    assert.equal(trigger('Claim Filing').textContent, 'MB · Medicare Part B');
    assert.equal(
      trigger('Corrections').textContent,
      'By Kind of Payer (Medicare Reopens, Others Replace)'
    );
    assert.equal(trigger('Plan Type').textContent, 'Unknown');
    assert.equal(trigger('Accepts Insurance Searches').textContent, 'No');
    assert.equal(days('Filing Limit (Days)').value, '');
    assert.deepEqual(
      [days('Filing Limit (Days)').min, days('Filing Limit (Days)').max],
      ['1', '3650']
    );
    assert.deepEqual(
      [days('Appeal Limit (Days)').min, days('Appeal Limit (Days)').max],
      ['1', '730']
    );
    assert.equal(
      screen.getByRole('link', { name: 'Cancel' }).getAttribute('href'),
      '/payers?q=part'
    );
  });

  it('saves the edited settings, says how many claims it linked and goes back', async () => {
    const { client, saved } = fakeClient();
    const toasts = show(client, 'p1');
    await form();
    const user = userEvent.setup();
    await user.clear(textbox('Clearinghouse Payer ID'));
    await user.type(textbox('Clearinghouse Payer ID'), 'MCRB1');
    await user.type(days('Filing Limit (Days)'), '365');
    await user.type(days('Appeal Limit (Days)'), '120');
    await choose(user, 'Corrections', 'Reopening request (Medicare)');
    await choose(user, 'Plan Type', 'Government');
    await choose(
      user,
      'Accepts Insurance Searches',
      'Yes: insurance discovery asks it about patients without coverage'
    );
    await user.click(screen.getByRole('button', { name: 'Save Payer' }));
    assert.deepEqual(saved, [
      {
        name: 'Medicare',
        payerCode: 'MCRB1',
        claimFiling: 'MB',
        filingLimitDays: 365,
        correctionMethod: 'reopening',
        appealDays: 120,
        planType: 'government',
        isSearchable: true
      }
    ]);
    await waitFor(() =>
      assert.deepEqual(toasts, [{ title: 'Medicare saved and linked to 2 claims' }])
    );
    assert.equal(here(), '/payers?q=part');
  });

  it('clears a day limit and a choice back to their defaults', async () => {
    const { client, saved } = fakeClient({
      payer: async () => ({
        ...medicare,
        filing_limit_days: 365,
        correction_method: 'replacement',
        plan_type: 'self_funded'
      })
    });
    show(client, 'p1');
    await form();
    const user = userEvent.setup();
    await user.clear(days('Filing Limit (Days)'));
    await choose(user, 'Corrections', 'By Kind of Payer (Medicare Reopens, Others Replace)');
    await choose(user, 'Plan Type', 'Unknown');
    await user.click(screen.getByRole('button', { name: 'Save Payer' }));
    assert.deepEqual(saved, [
      {
        name: 'Medicare',
        payerCode: '00952',
        claimFiling: 'MB',
        filingLimitDays: null,
        correctionMethod: null,
        appealDays: null,
        planType: null,
        isSearchable: false
      }
    ]);
  });

  it('adds a new payer from an empty form without learned names or a delete action', async () => {
    const { client, read, saved } = fakeClient();
    const toasts = show(client, null);
    await form();
    assert.ok(screen.getByRole('heading', { name: 'Add Payer', level: 1 }));
    assert.deepEqual(read, []);
    assert.equal(textbox('Payer Name').readOnly, false);
    assert.ok(!screen.queryByText('To rename a payer, add it again under the new name.'));
    assert.ok(!screen.queryByRole('heading', { name: 'Learned Names' }));
    assert.ok(!screen.queryByRole('button', { name: 'Delete Payer' }));
    const user = userEvent.setup();
    await user.type(textbox('Payer Name'), 'Blue Cross');
    await user.type(textbox('Clearinghouse Payer ID'), 'BC001');
    await choose(user, 'Claim Filing', 'BL · Blue Cross/Blue Shield');
    await user.click(screen.getByRole('button', { name: 'Save Payer' }));
    assert.deepEqual(saved, [
      {
        name: 'Blue Cross',
        payerCode: 'BC001',
        claimFiling: 'BL',
        filingLimitDays: null,
        correctionMethod: null,
        appealDays: null,
        planType: null,
        isSearchable: false
      }
    ]);
    await waitFor(() =>
      assert.deepEqual(toasts, [{ title: 'Blue Cross saved and linked to 2 claims' }])
    );
  });

  it('keeps the form open and says why the payer could not be saved', async () => {
    const { client } = fakeClient({
      save: async () => {
        throw new Error('Payer ID is already used');
      }
    });
    const toasts = show(client, 'p1');
    await form();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Save Payer' }));
    assert.equal((await screen.findByRole('alert')).textContent, 'Payer ID is already used');
    assert.deepEqual(toasts, []);
    assert.equal(here(), '/');
  });

  it('says when the payer could not be read', async () => {
    show(
      fakeClient({
        payer: async () => {
          throw new Error('Payer not found');
        }
      }).client,
      'p1'
    );
    assert.ok(await screen.findByText('Payer not found'));
    assert.ok(!screen.queryByRole('form', { name: 'Save Payer' }));
  });

  it('deletes the payer once confirmed and goes back', async () => {
    const { client, removed } = fakeClient();
    const toasts = show(client, 'p1');
    await form();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete Payer' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Medicare?' });
    assert.ok(
      within(dialog).getByText(
        'Its prices are removed, and claims billed to Medicare cannot go in an 837P file until it is added again.'
      )
    );
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => assert.deepEqual(toasts, [{ title: 'Medicare deleted' }]));
    assert.deepEqual(removed, ['p1']);
    assert.equal(here(), '/payers?q=part');
  });

  it('stays on the payer and says why it could not be deleted', async () => {
    const { client } = fakeClient({
      remove: async () => {
        throw new Error('Payer is billed on open claims');
      }
    });
    const toasts = show(client, 'p1');
    await form();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete Payer' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete Medicare?' })).getByRole('button', {
        name: 'Delete'
      })
    );
    await waitFor(() =>
      assert.deepEqual(toasts, [
        {
          intent: 'danger',
          title: 'Could not delete payer',
          description: 'Payer is billed on open claims'
        }
      ])
    );
    assert.equal(here(), '/');
  });

  it('lists the learned names in a table', async () => {
    const { client } = fakeClient();
    show(client, 'p1');
    const table = await screen.findByRole('table', { name: 'Learned Names for Medicare' });
    assert.deepEqual(
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((r) => within(r).getAllByRole('cell')[0]?.textContent),
      ['MCR Part B']
    );
  });

  it('says when no names have been learned yet', async () => {
    const { client } = fakeClient({ payer: async () => ({ ...medicare, aliases: [] }) });
    show(client, 'p1');
    assert.ok(
      await screen.findByText(
        'No learned names yet. They are added as billers match PCR payer names.'
      )
    );
    assert.ok(!screen.queryByRole('table'));
  });

  it('forgets a learned name once confirmed and reloads the payer', async () => {
    const { client, read, forgotten } = fakeClient();
    const toasts = show(client, 'p1');
    await form();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete MCR Part B' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete MCR Part B?' });
    assert.ok(
      within(dialog).getByText(
        'PCRs naming MCR Part B stop linking to Medicare; the next one goes to a Payer Matching task.'
      )
    );
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => assert.deepEqual(toasts, [{ title: 'MCR Part B deleted from Medicare' }]));
    assert.deepEqual(forgotten, [['p1', 'a1']]);
    await waitFor(() => assert.deepEqual(read, ['p1', 'p1']));
  });

  it('keeps a learned name when the deletion is not confirmed', async () => {
    const { client, forgotten } = fakeClient();
    show(client, 'p1');
    await form();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete MCR Part B' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete MCR Part B?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep' }));
    assert.equal(dialog.hasAttribute('open'), false);
    assert.deepEqual(forgotten, []);
  });

  it('says why a learned name could not be forgotten', async () => {
    const { client, read } = fakeClient({
      forgetAlias: async () => {
        throw new Error('Name is in use');
      }
    });
    const toasts = show(client, 'p1');
    await form();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete MCR Part B' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete MCR Part B?' })).getByRole('button', {
        name: 'Delete'
      })
    );
    await waitFor(() =>
      assert.deepEqual(toasts, [
        { intent: 'danger', title: 'Could not delete name', description: 'Name is in use' }
      ])
    );
    assert.deepEqual(read, ['p1']);
  });
});
