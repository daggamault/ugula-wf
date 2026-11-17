import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import { createElement } from 'react';
import { act, render, screen, userEvent, within } from '../testing-dom.ts';
import {
  accentClasses,
  addToast,
  TOAST_LIMIT,
  Toaster,
  type ToastInput,
  ToastProvider,
  useToast
} from './toast.tsx';

const item = (id: number, title = `T${id}`) => ({ id, title });

describe('addToast', () => {
  it('appends a new message', () => {
    assert.deepEqual(addToast([item(1)], item(2)), [item(1), item(2)]);
  });

  it('keeps only the newest few', () => {
    const toasts = Array.from({ length: TOAST_LIMIT + 2 }, (_, i) => item(i));
    assert.equal(TOAST_LIMIT, 4);
    assert.deepEqual(
      toasts.reduce(addToast, []).map((t) => t.id),
      [2, 3, 4, 5]
    );
  });

  it('updates a repeated title in place, keeping its id and so its timer', () => {
    const repeated = addToast([item(1), item(2)], { id: 9, title: 'T1', description: 'Again' });
    assert.deepEqual(repeated, [{ id: 1, title: 'T1', description: 'Again' }, item(2)]);
  });

  it('matches a repeat by key before title', () => {
    const keyed = addToast([{ id: 1, key: 'run', title: 'Started' }, item(2)], {
      id: 9,
      key: 'run',
      title: 'Finished'
    });
    assert.deepEqual(keyed, [{ id: 1, key: 'run', title: 'Finished' }, item(2)]);
  });

  it('keeps a keyed message apart from an unkeyed one with the same title', () => {
    assert.deepEqual(
      addToast([item(1, 'Saved')], { id: 2, key: 'fee', title: 'Saved' }).map((t) => t.id),
      [1, 2]
    );
  });
});

describe('accentClasses', () => {
  it('colors each intent with its token, using readable warning text', () => {
    assert.deepEqual(accentClasses, {
      primary: 'text-primary',
      success: 'text-success',
      info: 'text-info',
      warning: 'text-warning-text',
      danger: 'text-danger'
    });
  });
});

describe('Toaster', () => {
  const showToaster = () => {
    const dismissed: number[] = [];
    render(
      createElement(Toaster, {
        toasts: [
          { id: 1, title: 'PCR-1 approved', description: 'Next up: PCR-2' },
          {
            id: 2,
            intent: 'danger',
            title: 'Upload failed',
            action: { label: 'Open Imports', to: '/imports' }
          }
        ],
        onDismiss: (id) => dismissed.push(id)
      })
    );
    const region = screen.getByRole('region', { name: 'Notifications' });
    const cards = within(region).getAllByRole('listitem');
    return { dismissed, region, cards, user: userEvent.setup() };
  };

  it('announces politely from one live region, without alert or status roles', () => {
    const { region } = showToaster();
    assert.equal(region.getAttribute('aria-live'), 'polite');
    assert.equal(region.getAttribute('aria-relevant'), 'additions text');
    assert.ok(!screen.queryByRole('alert'));
    assert.ok(!screen.queryByRole('status'));
  });

  it('lists each message with its title and description', () => {
    const { cards } = showToaster();
    assert.equal(cards.length, 2);
    within(cards[0] as HTMLElement).getByText('PCR-1 approved');
    within(cards[0] as HTMLElement).getByText('Next up: PCR-2');
    within(cards[1] as HTMLElement).getByText('Upload failed');
  });

  it('shows a decorative success icon by default and the intent icon otherwise', () => {
    const { cards } = showToaster();
    const icons = cards.map((card) => card.querySelector('svg'));
    assert.deepEqual(
      icons.map((icon) => icon?.getAttribute('aria-hidden')),
      ['true', 'true']
    );
    assert.ok(icons[0]?.classList.contains('lucide-circle-check'));
    assert.ok(icons[0]?.classList.contains('text-success'));
    assert.ok(icons[1]?.classList.contains('lucide-circle-alert'));
    assert.ok(icons[1]?.classList.contains('text-danger'));
  });

  it('links to a follow-up action', () => {
    const { cards } = showToaster();
    const link = within(cards[1] as HTMLElement).getByRole('link', { name: 'Open Imports' });
    assert.equal(link.getAttribute('href'), '/imports');
    assert.ok(!within(cards[0] as HTMLElement).queryByRole('link'));
  });

  it('dismisses a message from its button', async () => {
    const { cards, dismissed, user } = showToaster();
    await user.click(within(cards[1] as HTMLElement).getByRole('button', { name: 'Dismiss' }));
    assert.deepEqual(dismissed, [2]);
  });

  it('dismisses a message when following its action', async () => {
    const { dismissed, user } = showToaster();
    await user.click(screen.getByRole('link', { name: 'Open Imports' }));
    assert.deepEqual(dismissed, [2]);
    assert.equal(window.location.pathname, '/imports');
  });
});

describe('ToastProvider', () => {
  const showProvider = (t?: TestContext) => {
    if (t) t.mock.timers.enable({ apis: ['setTimeout'] });
    const recorded: ToastInput[] = [];
    let notify: (toast: ToastInput) => void = () => undefined;
    const Probe = () => {
      notify = useToast();
      return createElement('p', null, 'App');
    };
    render(
      createElement(ToastProvider, {
        onNotify: (toast) => recorded.push(toast),
        children: createElement(Probe)
      })
    );
    const region = screen.getByRole('region', { name: 'Notifications' });
    return {
      recorded,
      region,
      show: (toast: ToastInput) => act(() => notify(toast)),
      titles: () =>
        within(region)
          .queryAllByRole('listitem')
          .map((li) => li.querySelector('p')?.textContent),
      tick: (ms: number) => act(() => t?.mock.timers.tick(ms))
    };
  };

  it('renders its children above an empty live region', () => {
    const { region, titles } = showProvider();
    screen.getByText('App');
    assert.deepEqual(titles(), []);
    assert.ok(region.previousElementSibling?.textContent === 'App');
  });

  it('shows and records each message', () => {
    const { recorded, show, titles } = showProvider();
    show({ title: 'Saved' });
    show({ title: 'Deleted', intent: 'danger' });
    assert.deepEqual(titles(), ['Saved', 'Deleted']);
    assert.deepEqual(recorded, [{ title: 'Saved' }, { title: 'Deleted', intent: 'danger' }]);
  });

  it('shows but does not record a message marked unrecorded', () => {
    const { recorded, show, titles } = showProvider();
    show({ title: 'Copied', isRecorded: false });
    assert.deepEqual(titles(), ['Copied']);
    assert.deepEqual(recorded, []);
  });

  it('shows a repeated message once', () => {
    const { show, titles } = showProvider();
    show({ title: 'Saved' });
    show({ title: 'Saved' });
    assert.deepEqual(titles(), ['Saved']);
  });

  it('dismisses a message from its button', async () => {
    const { show, titles } = showProvider();
    show({ title: 'Saved' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }));
    assert.deepEqual(titles(), []);
  });

  it('dismisses a message on its own after six seconds', (t) => {
    const { show, tick, titles } = showProvider(t);
    show({ title: 'Saved' });
    tick(5_999);
    assert.deepEqual(titles(), ['Saved']);
    tick(1);
    assert.deepEqual(titles(), []);
  });

  it('keeps the first timer when a message repeats', (t) => {
    const { show, tick, titles } = showProvider(t);
    show({ title: 'Saved' });
    tick(4_000);
    show({ title: 'Saved', description: 'Again' });
    tick(2_000);
    assert.deepEqual(titles(), []);
  });

  it('holds a message while the pointer is over it', (t) => {
    const { region, show, tick, titles } = showProvider(t);
    show({ title: 'Saved' });
    const card = within(region).getByRole('listitem');
    act(() => {
      card.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    });
    tick(10_000);
    assert.deepEqual(titles(), ['Saved']);
    act(() => {
      card.dispatchEvent(
        new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body })
      );
    });
    tick(5_999);
    assert.deepEqual(titles(), ['Saved']);
    tick(1);
    assert.deepEqual(titles(), []);
  });

  it('holds a message while focus is inside it', (t) => {
    const { region, show, tick, titles } = showProvider(t);
    show({ title: 'Saved' });
    const dismiss = within(region).getByRole('button', { name: 'Dismiss' });
    act(() => dismiss.focus());
    tick(10_000);
    assert.deepEqual(titles(), ['Saved']);
    act(() => dismiss.blur());
    tick(6_000);
    assert.deepEqual(titles(), []);
  });

  it('does nothing when used outside a provider', () => {
    let notify: (toast: ToastInput) => void = () => undefined;
    const Probe = () => {
      notify = useToast();
      return null;
    };
    render(createElement(Probe));
    assert.doesNotThrow(() => notify({ title: 'Lost' }));
    assert.ok(!screen.queryByRole('region'));
  });
});
