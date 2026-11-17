import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createElement } from 'react';
import { guardChanges, navigate, stay } from '../router.tsx';
import { act, render, screen, userEvent, within } from '../testing-dom.ts';
import { UnsavedChangesDialog } from './unsaved-changes-dialog.tsx';

let release: () => void = () => undefined;

beforeEach(() => {
  window.history.replaceState(null, '', '/fees/f1');
  release = guardChanges([]);
});

afterEach(() => {
  release();
  stay();
});

const holdLeave = () => {
  render(createElement(UnsavedChangesDialog));
  act(() => navigate('/fees'));
  return screen.getByRole('dialog', { name: 'Discard Unsaved Changes?' }) as HTMLDialogElement;
};

describe('UnsavedChangesDialog', () => {
  it('stays closed while no navigation is held', () => {
    render(createElement(UnsavedChangesDialog));
    const dialog = screen.getByRole('dialog', { hidden: true }) as HTMLDialogElement;
    assert.equal(dialog.open, false);
  });

  it('opens as a danger confirmation when leaving with unsaved changes', () => {
    const dialog = holdLeave();
    assert.equal(dialog.open, true);
    assert.equal(window.location.pathname, '/fees/f1');
    within(dialog).getByText('Your changes have not been saved. Leave anyway and lose them?');
    assert.ok(dialog.classList.contains('border-danger/30'));
    const discard = within(dialog).getByRole('button', { name: 'Discard Changes' });
    assert.ok(discard.classList.contains('bg-danger'));
  });

  it('keeps editing on the same page', async () => {
    const dialog = holdLeave();
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Keep Editing' }));
    assert.equal(dialog.open, false);
    assert.equal(window.location.pathname, '/fees/f1');
  });

  it('keeps editing when closed', async () => {
    const dialog = holdLeave();
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Close' }));
    assert.equal(dialog.open, false);
    assert.equal(window.location.pathname, '/fees/f1');
  });

  it('discards the changes and finishes the held navigation', async () => {
    const dialog = holdLeave();
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Discard Changes' }));
    assert.equal(dialog.open, false);
    assert.equal(window.location.pathname, '/fees');
  });
});
