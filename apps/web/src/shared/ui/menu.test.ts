import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PlayIcon } from 'lucide-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Menu } from './menu.tsx';

const render = (isPending = false) =>
  renderToStaticMarkup(
    createElement(Menu, {
      label: 'Start Task',
      icon: PlayIcon,
      isPending,
      groups: [
        {
          label: 'Change the Claim',
          items: [
            {
              label: 'Post Payment',
              description: 'A payment by mail.',
              icon: PlayIcon,
              onSelect: () => undefined
            },
            {
              label: 'Change Payers',
              description: 'Reorder payers.',
              icon: PlayIcon,
              disabledReason: 'This claim is closed.',
              onSelect: () => undefined
            }
          ]
        }
      ]
    })
  );

describe('Menu', () => {
  it('opens grouped menu items from a button, each with what it does', () => {
    const html = render();
    assert.ok(html.includes('aria-haspopup="menu"') && html.includes('role="menu"'));
    assert.ok(html.includes('Change the Claim</legend>'));
    assert.equal(html.match(/role="menuitem"/g)?.length, 2);
    assert.ok(html.includes('A payment by mail.'));
  });

  it('says why an item cannot be chosen instead of what it does', () => {
    const html = render();
    assert.ok(html.includes('aria-disabled="true"') && html.includes('This claim is closed.'));
    assert.ok(!html.includes('Reorder payers.'));
  });

  it('shows the button busy while an item is starting', () => {
    assert.ok(render(true).includes('aria-busy="true"'));
    assert.ok(!render().includes('aria-busy="true"'));
  });
});
