import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import { type ToastInput, ToastProvider } from '../../shared/ui/toast.tsx';
import type { DirectoryPayer, Fee, FeeInput, FeesClient } from './client.ts';
import { FeePage, payerOptions, toFeeDraft, toFeeInput } from './fee-page.tsx';

const fee = (over: Partial<Fee> = {}): Fee => ({
  id: 'f1',
  payer_id: null,
  payer: null,
  code: 'A0427',
  amount_cents: 95000,
  updated_at: '2026-10-01T00:00:00Z',
  ...over
});

const medicare = { id: 'p-m', name: 'Medicare' };
const aetna = { id: 'p-a', name: 'Aetna' };
const DIRECTORY: DirectoryPayer[] = [medicare, aetna];

const medicareFee = fee({ payer_id: 'p-m', payer: 'Medicare' });

const fakeClient = (over: Partial<FeesClient> = {}) => {
  const read: string[] = [];
  const searched: string[] = [];
  const saved: FeeInput[] = [];
  const removed: string[] = [];
  const client = {
    fee: async (id: string) => {
      read.push(id);
      return medicareFee;
    },
    payers: async (q: string) => {
      searched.push(q);
      return DIRECTORY.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
    },
    save: async (input: FeeInput) => {
      saved.push(input);
      const payer = DIRECTORY.find((p) => p.id === input.payerId)?.name ?? null;
      return fee({ payer_id: input.payerId, payer, code: input.code });
    },
    remove: async (id: string) => {
      removed.push(id);
      return { id };
    },
    ...over
  } as FeesClient;
  return { client, read, searched, saved, removed };
};

const show = (client: FeesClient, feeId: string | null) => {
  window.history.replaceState(null, '', feeId ? `/fees/${feeId}` : '/fees/new');
  const toasts: ToastInput[] = [];
  render(
    createElement(
      ToastProvider,
      { onNotify: (t) => toasts.push(t) },
      createElement(FeePage, { client, live: idleLive, feeId, back: '/fees?q=a04' })
    )
  );
  return toasts;
};

const code = () => screen.getByRole('textbox', { name: 'HCPCS' }) as HTMLInputElement;
const amount = () => screen.getByRole('spinbutton', { name: 'Amount (USD)' }) as HTMLInputElement;
const payerList = () => screen.getByRole('listbox', { name: 'Payer', hidden: true });
const payerOptionLabels = () =>
  within(payerList())
    .queryAllByRole('option', { hidden: true })
    .map((o) => o.textContent);
const save = () => screen.getByRole('button', { name: 'Save Fee' });
const location = () => `${window.location.pathname}${window.location.search}`;

const openEdit = async (client: FeesClient) => {
  const toasts = show(client, 'f1');
  await screen.findByRole('heading', { name: 'Medicare A0427', level: 1 });
  return toasts;
};

describe('FeePage', () => {
  it('adds a fee to the default schedule or any directory payer', async () => {
    const { client, read, searched } = fakeClient();
    show(client, null);
    assert.ok(screen.getByRole('heading', { name: 'Add Fee', level: 1 }));
    assert.equal(
      screen.getByRole('link', { name: 'Back to Fees' }).getAttribute('href'),
      '/fees?q=a04'
    );
    await waitFor(() =>
      assert.deepEqual(payerOptionLabels(), ['Default Schedule (Every Payer)', 'Medicare', 'Aetna'])
    );
    assert.equal(
      within(payerList()).getByRole('option', { selected: true, hidden: true }).textContent,
      'Default Schedule (Every Payer)'
    );
    assert.deepEqual([code().value, code().readOnly, amount().value], ['', false, '']);
    assert.ok(!screen.queryByRole('button', { name: 'Delete Fee' }));
    assert.deepEqual(searched, ['']);
    assert.deepEqual(read, []);
  });

  it('adds a default fee in cents with the code upper-cased and returns to the list', async () => {
    const { client, saved } = fakeClient();
    const toasts = show(client, null);
    const user = userEvent.setup();
    await user.type(code(), ' a0427 ');
    await user.type(amount(), '950.5');
    await user.click(save());
    await waitFor(() => assert.deepEqual(toasts, [{ title: 'Default A0427 added' }]));
    assert.deepEqual(saved, [{ payerId: null, code: 'A0427', amountCents: 95050 }]);
    assert.equal(location(), '/fees?q=a04');
  });

  it('prices a code for a payer found by name', async () => {
    const { client, saved, searched } = fakeClient();
    const toasts = show(client, null);
    const user = userEvent.setup();
    await user.type(screen.getByRole('combobox', { name: 'Search Payer', hidden: true }), 'medi');
    await waitFor(() => assert.deepEqual(payerOptionLabels(), ['Medicare']));
    assert.deepEqual(searched, ['', 'medi']);
    await user.click(within(payerList()).getByRole('option', { name: 'Medicare', hidden: true }));
    await user.type(code(), 'A0425');
    await user.type(amount(), '15.55');
    await user.click(save());
    await waitFor(() => assert.deepEqual(toasts, [{ title: 'Medicare A0425 added' }]));
    assert.deepEqual(saved, [{ payerId: 'p-m', code: 'A0425', amountCents: 1555 }]);
  });

  it('asks for a code when only spaces were typed', async () => {
    const { client, saved } = fakeClient();
    show(client, null);
    const user = userEvent.setup();
    await user.type(code(), '   ');
    await user.type(amount(), '1');
    await user.click(save());
    assert.equal(screen.getByRole('alert').textContent, 'Enter a HCPCS code.');
    assert.deepEqual(saved, []);
    assert.equal(location(), '/fees/new');
  });

  it('opens a fee with its payer and code fixed and only the amount editable', async () => {
    const { client, read } = fakeClient();
    await openEdit(client);
    const payer = screen.getByRole('textbox', { name: 'Payer' }) as HTMLInputElement;
    assert.deepEqual([payer.value, payer.readOnly], ['Medicare', true]);
    assert.deepEqual([code().value, code().readOnly], ['A0427', true]);
    assert.deepEqual([amount().value, amount().readOnly], ['950.00', false]);
    assert.ok(screen.getByText('To price another code or payer, add a fee.'));
    assert.ok(!screen.queryByRole('listbox', { name: 'Payer', hidden: true }));
    assert.deepEqual(read, ['f1']);
  });

  it('updates the amount of a fee', async () => {
    const { client, saved } = fakeClient();
    const toasts = await openEdit(client);
    const user = userEvent.setup();
    await user.clear(amount());
    await user.type(amount(), '1000');
    await user.click(save());
    await waitFor(() => assert.deepEqual(toasts, [{ title: 'Medicare A0427 updated' }]));
    assert.deepEqual(saved, [{ payerId: 'p-m', code: 'A0427', amountCents: 100000 }]);
    assert.equal(location(), '/fees?q=a04');
  });

  it('says why a fee could not be saved and stays on the form', async () => {
    const { client } = fakeClient({
      save: async () => {
        throw new Error('Payer is not in the directory');
      }
    });
    const toasts = await openEdit(client);
    await userEvent.setup().click(save());
    assert.equal((await screen.findByRole('alert')).textContent, 'Payer is not in the directory');
    assert.deepEqual(toasts, []);
    assert.equal(location(), '/fees/f1');
  });

  it('deletes a fee once confirmed and returns to the list', async () => {
    const { client, removed } = fakeClient();
    const toasts = await openEdit(client);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete Fee' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Medicare A0427?' });
    assert.ok(
      within(dialog).getByText('Claims will no longer be priced with $950.00 for Medicare A0427.')
    );
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => assert.deepEqual(toasts, [{ title: 'Medicare A0427 deleted' }]));
    assert.deepEqual(removed, ['f1']);
    assert.equal(location(), '/fees?q=a04');
  });

  it('says why a fee could not be deleted and stays on it', async () => {
    const { client } = fakeClient({
      remove: async () => {
        throw new Error('Fee is in use');
      }
    });
    const toasts = await openEdit(client);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete Fee' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete Medicare A0427?' })).getByRole('button', {
        name: 'Delete'
      })
    );
    await waitFor(() =>
      assert.deepEqual(toasts, [
        { intent: 'danger', title: 'Could not delete fee', description: 'Fee is in use' }
      ])
    );
    assert.equal(location(), '/fees/f1');
  });

  it('says why the fee could not be opened', async () => {
    const { client } = fakeClient({
      fee: async () => {
        throw new Error('Fee not found');
      }
    });
    show(client, 'f1');
    assert.ok(await screen.findByRole('heading', { name: 'Something Went Wrong' }));
    assert.ok(screen.getByText('Fee not found'));
  });
});

describe('toFeeInput', () => {
  it('converts the form into cents and an optional directory payer', () => {
    assert.deepEqual(toFeeInput({ payerId: '', code: ' a0427 ', amount: '950.5' }), {
      payerId: null,
      code: 'A0427',
      amountCents: 95050
    });
    assert.deepEqual(toFeeInput({ payerId: 'p-m', code: 'A0425', amount: '15.55' }), {
      payerId: 'p-m',
      code: 'A0425',
      amountCents: 1555
    });
  });

  it('asks for a code before checking the amount', () => {
    assert.equal(toFeeInput({ payerId: '', code: '  ', amount: '' }), 'Enter a HCPCS code.');
  });

  it('refuses a missing or negative amount', () => {
    for (const amount of ['', '-1']) {
      assert.equal(
        toFeeInput({ payerId: '', code: 'A0427', amount }),
        'Enter an amount of zero or more.'
      );
    }
  });
});

describe('toFeeDraft', () => {
  it('shows a stored fee in dollars and a new fee blank', () => {
    assert.deepEqual(toFeeDraft(fee({ payer_id: 'p-m', amount_cents: 1555 })), {
      payerId: 'p-m',
      code: 'A0427',
      amount: '15.55'
    });
    assert.deepEqual(toFeeDraft(null), { payerId: '', code: '', amount: '' });
  });
});

describe('payerOptions', () => {
  it('offers the default schedule, then the chosen payer, then the matches', () => {
    assert.deepEqual(payerOptions([aetna], medicare), [
      { value: '', label: 'Default Schedule (Every Payer)' },
      { value: 'p-m', label: 'Medicare' },
      { value: 'p-a', label: 'Aetna' }
    ]);
  });

  it('lists a chosen payer that is also a match only once', () => {
    assert.deepEqual(payerOptions([medicare], medicare), [
      { value: '', label: 'Default Schedule (Every Payer)' },
      { value: 'p-m', label: 'Medicare' }
    ]);
  });
});
