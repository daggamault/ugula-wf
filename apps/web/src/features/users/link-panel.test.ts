import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent, waitFor } from '../../shared/testing-dom.ts';
import { type ToastInput, ToastProvider } from '../../shared/ui/toast.tsx';
import { LinkPanel } from './link-panel.tsx';

const LINK = 'http://app.test/invitation?token=t1';

const show = () => {
  const toasts: ToastInput[] = [];
  const user = userEvent.setup();
  render(
    createElement(
      ToastProvider,
      { onNotify: (t) => toasts.push(t) },
      createElement(LinkPanel, {
        title: 'Invitation for Ann Lee',
        description: 'Send this link.',
        link: LINK
      })
    )
  );
  return { toasts, user };
};

describe('LinkPanel', () => {
  it('shows the link read-only under its title and description', () => {
    show();
    assert.ok(screen.getByRole('heading', { name: 'Invitation for Ann Lee' }));
    assert.ok(screen.getByText('Send this link.'));
    const link = screen.getByRole('textbox', { name: 'Link' }) as HTMLInputElement;
    assert.equal(link.value, LINK);
    assert.equal(link.readOnly, true);
  });

  it('copies the link and says so', async () => {
    const { toasts, user } = show();
    await user.click(screen.getByRole('button', { name: 'Copy Link' }));
    assert.equal(await navigator.clipboard.readText(), LINK);
    await waitFor(() => assert.deepEqual(toasts, [{ title: 'Link copied' }]));
  });

  it('says when the link could not be copied', async () => {
    const { toasts, user } = show();
    navigator.clipboard.writeText = async () => {
      throw new Error('denied');
    };
    await user.click(screen.getByRole('button', { name: 'Copy Link' }));
    await waitFor(() =>
      assert.deepEqual(toasts, [{ intent: 'danger', title: 'Could not copy the link' }])
    );
  });
});
