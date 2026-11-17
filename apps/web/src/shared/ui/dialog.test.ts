import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CheckIcon, Trash2Icon } from 'lucide-react';
import { createElement, type ReactNode, useState } from 'react';
import { act, render, screen, userEvent, within } from '../testing-dom.ts';
import { ConfirmDialog, DeleteDialog, Dialog } from './dialog.tsx';

type DialogProps = Parameters<typeof Dialog>[0];

const showDialog = (props: Partial<DialogProps> = {}) => {
  const closes: string[] = [];
  const make = (open: boolean) =>
    createElement(Dialog, {
      title: 'New Workflow',
      onClose: () => closes.push('close'),
      children: createElement('p', null, 'Body'),
      ...props,
      open
    });
  const { rerender } = render(make(props.open ?? true));
  return { closes, setOpen: (open: boolean) => rerender(make(open)), user: userEvent.setup() };
};

const dialogNamed = (name: string) => screen.getByRole('dialog', { name }) as HTMLDialogElement;

describe('Dialog', () => {
  it('opens as a modal named by its title', () => {
    showDialog({ description: 'Pick a trigger.' });
    const dialog = dialogNamed('New Workflow');
    assert.equal(dialog.open, true);
    assert.equal(within(dialog).getByRole('heading', { level: 2 }).textContent, 'New Workflow');
    within(dialog).getByText('Pick a trigger.');
    within(dialog).getByText('Body');
  });

  it('stays closed until asked to open, then closes again without reporting a dismissal', () => {
    const { closes, setOpen } = showDialog({ open: false });
    const dialog = screen.getByRole('dialog', { hidden: true }) as HTMLDialogElement;
    assert.equal(dialog.open, false);
    setOpen(true);
    assert.equal(dialog.open, true);
    setOpen(false);
    assert.equal(dialog.open, false);
    assert.deepEqual(closes, []);
  });

  it('reports a dismissal from its close button', async () => {
    const { closes, user } = showDialog();
    const dialog = dialogNamed('New Workflow');
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    assert.equal(dialog.open, false);
    assert.deepEqual(closes, ['close']);
  });

  it('reports a dismissal when closed by the browser, e.g. with Escape', () => {
    const { closes } = showDialog();
    act(() => dialogNamed('New Workflow').close());
    assert.deepEqual(closes, ['close']);
  });

  it('shows no warning icon without an intent', () => {
    showDialog();
    assert.ok(!dialogNamed('New Workflow').querySelector('header > [aria-hidden="true"]'));
  });

  it('shows a decorative warning icon and border for an intent', () => {
    showDialog({ intent: 'warning' });
    const dialog = dialogNamed('New Workflow');
    const icon = dialog.querySelector('header > [aria-hidden="true"]');
    assert.equal(icon?.querySelector('svg') !== null, true);
    assert.equal(icon?.classList.contains('text-warning-text'), true);
    assert.equal(dialog.classList.contains('border-warning/30'), true);
  });

  it('widens on request', () => {
    showDialog({ isWide: true });
    const classes = dialogNamed('New Workflow').classList;
    assert.equal(classes.contains('max-w-2xl'), true);
    assert.equal(classes.contains('max-w-md'), false);
  });
});

const showConfirm = (props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) => {
  const calls: string[] = [];
  render(
    createElement(ConfirmDialog, {
      open: true,
      title: 'Publish Workflow?',
      confirmLabel: 'Publish',
      confirmIcon: CheckIcon,
      onConfirm: () => calls.push('confirm'),
      onClose: () => calls.push('close'),
      children: 'Runs start using it.',
      ...props
    })
  );
  return {
    calls,
    dialog: dialogNamed(props.title ?? 'Publish Workflow?'),
    user: userEvent.setup()
  };
};

describe('ConfirmDialog', () => {
  it('explains what happens and offers Cancel then the confirm action', () => {
    const { dialog } = showConfirm();
    within(dialog).getByText('Runs start using it.');
    const actions = within(dialog)
      .getAllByRole('button')
      .map((b) => b.textContent);
    assert.deepEqual(actions, ['', 'Cancel', 'Publish']);
    assert.equal(
      within(dialog).getByRole('button', { name: 'Publish' }).classList.contains('bg-primary'),
      true
    );
  });

  it('confirms only through the confirm action', async () => {
    const { calls, dialog, user } = showConfirm();
    await user.click(within(dialog).getByRole('button', { name: 'Publish' }));
    assert.deepEqual(calls, ['confirm']);
  });

  it('dismisses through the dismiss action', async () => {
    const { calls, dialog, user } = showConfirm({ dismissLabel: 'Not now' });
    await user.click(within(dialog).getByRole('button', { name: 'Not now' }));
    assert.deepEqual(calls, ['close']);
  });

  it('colors the confirm action by intent', () => {
    const { dialog } = showConfirm({
      title: 'Delete Fee?',
      intent: 'danger',
      confirmLabel: 'Delete',
      confirmIcon: Trash2Icon
    });
    const confirm = within(dialog).getByRole('button', { name: 'Delete' });
    assert.equal(confirm.classList.contains('bg-danger'), true);
    assert.equal(dialog.classList.contains('border-danger/30'), true);
  });
});

const showDelete = (children?: ReactNode) => {
  const calls: string[] = [];
  const Host = () => {
    const [open, setOpen] = useState(true);
    return createElement(DeleteDialog, {
      open,
      name: 'Medicare',
      onConfirm: () => calls.push('confirm'),
      onClose: () => {
        calls.push('close');
        setOpen(false);
      },
      children
    });
  };
  render(createElement(Host));
  return { calls, dialog: dialogNamed('Delete Medicare?'), user: userEvent.setup() };
};

describe('DeleteDialog', () => {
  it('asks whether to delete the named thing and says it is permanent', () => {
    const { dialog } = showDelete();
    assert.equal(
      dialog.querySelector('h2 + div')?.textContent,
      'Are you sure you want to delete Medicare? This cannot be undone.'
    );
    assert.equal(within(dialog).getByText('Medicare').tagName, 'STRONG');
  });

  it('adds what else changes', () => {
    const { dialog } = showDelete('Its prices are removed.');
    assert.equal(
      dialog.querySelector('h2 + div')?.textContent,
      'Are you sure you want to delete Medicare? This cannot be undone.Its prices are removed.'
    );
  });

  it('keeps the thing with Keep and deletes it with a danger Delete action', async () => {
    const { calls, dialog, user } = showDelete();
    const del = within(dialog).getByRole('button', { name: 'Delete' });
    assert.equal(del.classList.contains('bg-danger'), true);
    await user.click(del);
    await user.click(within(dialog).getByRole('button', { name: 'Keep' }));
    assert.deepEqual(calls, ['confirm', 'close']);
    assert.equal(dialog.open, false);
  });
});
