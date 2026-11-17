import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent, within } from '../testing-dom.ts';
import { Alert, AlertList } from './alert.tsx';
import type { Intent } from './intent.ts';

describe('Alert', () => {
  it('announces danger as an alert by default', () => {
    render(createElement(Alert, { children: 'Invalid credentials' }));
    assert.equal(screen.getByRole('alert').textContent, 'Invalid credentials');
    assert.ok(!screen.queryByRole('status'));
  });

  it('announces every other intent politely as a status', () => {
    for (const intent of ['primary', 'success', 'info', 'warning'] as Intent[]) {
      const { unmount } = render(createElement(Alert, { intent, children: intent }));
      assert.equal(screen.getByRole('status').textContent, intent);
      assert.ok(!screen.queryByRole('alert'));
      unmount();
    }
  });

  it('colors the alert by intent', () => {
    render(createElement(Alert, { intent: 'info', children: 'Heads up' }));
    const classes = screen.getByRole('status').classList;
    assert.equal(classes.contains('bg-info/10'), true);
    assert.equal(classes.contains('border-info/30'), true);
  });

  it('hides the intent icon from assistive tech', () => {
    render(createElement(Alert, { children: 'Failed' }));
    const icon = screen.getByRole('alert').querySelector('svg');
    assert.equal(icon?.getAttribute('aria-hidden'), 'true');
  });

  it('renders a working action beside the message', async () => {
    const clicks: string[] = [];
    render(
      createElement(Alert, {
        intent: 'warning',
        action: createElement(
          'button',
          { type: 'button', onClick: () => clicks.push('fix') },
          'Fix'
        ),
        children: 'Needs setup'
      })
    );
    await userEvent
      .setup()
      .click(within(screen.getByRole('status')).getByRole('button', { name: 'Fix' }));
    assert.deepEqual(clicks, ['fix']);
  });

  it('renders no action area without an action', () => {
    render(createElement(Alert, { intent: 'info', children: 'Heads up' }));
    assert.equal(screen.getByRole('status').childElementCount, 1);
  });
});

describe('AlertList', () => {
  it('titles a list of messages, prefixing each with its label when it has one', () => {
    render(
      createElement(AlertList, {
        intent: 'warning',
        title: 'Warnings',
        items: [{ label: 'Loaded Miles', text: 'Over 100' }, { text: 'Narrative unread' }]
      })
    );
    const status = screen.getByRole('status');
    assert.equal(status.querySelector('strong')?.textContent, 'Warnings');
    assert.deepEqual(
      within(status)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
      ['Loaded Miles: Over 100', 'Narrative unread']
    );
  });

  it('announces a danger list as an alert', () => {
    render(createElement(AlertList, { intent: 'danger', title: 'Errors', items: [{ text: 'x' }] }));
    assert.equal(screen.getByRole('alert').querySelector('strong')?.textContent, 'Errors');
  });
});
