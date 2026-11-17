import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent } from '../testing-dom.ts';
import { Button, ButtonLink, buttonClasses } from './button.tsx';

const INTENTS = ['primary', 'success', 'info', 'warning', 'danger'] as const;

const classesOf = (...args: Parameters<typeof buttonClasses>) => buttonClasses(...args).split(' ');

const showButton = (props: Parameters<typeof Button>[0]) => {
  const clicks: string[] = [];
  render(createElement(Button, { onClick: () => clicks.push('click'), ...props }));
  return { clicks, user: userEvent.setup() };
};

describe('buttonClasses', () => {
  it('fills a solid primary button at the medium size by default', () => {
    const classes = classesOf();
    assert.equal(classes.includes('bg-primary'), true);
    assert.equal(classes.includes('text-primary-fg'), true);
    assert.equal(classes.includes('h-10'), true);
    assert.equal(classes.includes('border'), false);
  });

  it('fills solid buttons with the intent color', () => {
    for (const intent of INTENTS) {
      assert.equal(classesOf({ intent }).includes(`bg-${intent}`), true, intent);
    }
  });

  it('borders outline buttons on the opaque surface, tinted by intent', () => {
    assert.equal(classesOf({ variant: 'outline' }).includes('border-border'), true);
    const danger = classesOf({ intent: 'danger', variant: 'outline' });
    assert.equal(danger.includes('border'), true);
    assert.equal(danger.includes('bg-surface'), true);
    assert.equal(danger.includes('not-aria-disabled:hover:bg-surface-hover'), true);
    assert.equal(danger.includes('text-danger'), true);
    assert.equal(danger.includes('bg-danger'), false);
  });

  it('shrinks the small size', () => {
    const classes = classesOf({ size: 'sm' });
    assert.equal(classes.includes('h-8'), true);
    assert.equal(classes.includes('h-10'), false);
  });

  it('draws every variant flat, without a shadow', () => {
    for (const variant of ['solid', 'outline'] as const) {
      for (const intent of INTENTS) {
        assert.deepEqual(
          classesOf({ intent, variant }).filter((c) => c.includes('shadow')),
          [],
          `${variant} ${intent}`
        );
      }
    }
  });
});

describe('Button', () => {
  it('renders a plain button that does not submit forms by default', () => {
    showButton({ children: 'Save' });
    const button = screen.getByRole('button', { name: 'Save' });
    assert.equal(button.getAttribute('type'), 'button');
    assert.equal(button.getAttribute('aria-disabled'), null);
    assert.equal(button.getAttribute('aria-busy'), null);
    assert.equal(button.getAttribute('aria-describedby'), null);
    assert.equal(button.classList.contains('w-full'), false);
  });

  it('runs its click handler when enabled', async () => {
    const { clicks, user } = showButton({ children: 'Save' });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    assert.deepEqual(clicks, ['click']);
  });

  it('spans the full width when block', () => {
    showButton({ isBlock: true, children: 'Go' });
    assert.equal(screen.getByRole('button', { name: 'Go' }).classList.contains('w-full'), true);
  });

  it('stays focusable when blocked and describes why', () => {
    showButton({ disabledReason: 'No changes to save.', children: 'Save' });
    const button = screen.getByRole('button', {
      name: 'Save',
      description: 'No changes to save.'
    });
    assert.equal(button.getAttribute('aria-disabled'), 'true');
    assert.equal(button.hasAttribute('disabled'), false);
    button.focus();
    assert.ok(document.activeElement === button);
  });

  it('keeps its own description after the blocked reason', () => {
    render(
      createElement(
        'div',
        null,
        createElement('p', { id: 'hint' }, 'Saves the draft.'),
        createElement(
          Button,
          { disabledReason: 'Nothing to save.', 'aria-describedby': 'hint' },
          'Save'
        )
      )
    );
    screen.getByRole('button', { name: 'Save', description: 'Nothing to save. Saves the draft.' });
  });

  it('ignores clicks and does not submit its form when blocked', async () => {
    const submits: string[] = [];
    const clicks: string[] = [];
    render(
      createElement(
        'form',
        {
          onSubmit: (e: { preventDefault: () => void }) => {
            e.preventDefault();
            submits.push('submit');
          }
        },
        createElement(
          Button,
          {
            type: 'submit',
            disabledReason: 'Fix the errors.',
            onClick: () => clicks.push('click')
          },
          'Save'
        )
      )
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }));
    assert.deepEqual(clicks, []);
    assert.deepEqual(submits, []);
  });

  it('explains a blocked button in a tooltip only while blocked', () => {
    const { rerender } = render(
      createElement(Button, { disabledReason: 'No changes to save.' }, 'Save')
    );
    const tip = screen.getByText('No changes to save.', { selector: '[popover]' });
    assert.equal(tip.getAttribute('aria-hidden'), 'true');
    rerender(createElement(Button, null, 'Save'));
    assert.ok(!document.querySelector('[popover]'));
  });

  it('marks itself busy, hides its label visually and ignores clicks while pending', async () => {
    const { clicks, user } = showButton({ isPending: true, children: 'Go' });
    const button = screen.getByRole('button', { name: 'Go' });
    assert.equal(button.getAttribute('aria-busy'), 'true');
    assert.equal(button.getAttribute('aria-disabled'), 'true');
    assert.equal(button.getAttribute('aria-describedby'), null);
    assert.ok(!document.querySelector('[popover]'));
    assert.equal(screen.getByText('Go').classList.contains('opacity-0'), true);
    await user.click(button);
    assert.deepEqual(clicks, []);
  });
});

describe('ButtonLink', () => {
  it('renders a link styled as a button that navigates in place', async () => {
    render(createElement(ButtonLink, { to: '/runs', variant: 'outline' }, 'Runs'));
    const link = screen.getByRole('link', { name: 'Runs' });
    assert.equal(link.getAttribute('href'), '/runs');
    assert.equal(link.className, buttonClasses({ variant: 'outline' }));
    await userEvent.setup().click(link);
    assert.equal(window.location.pathname, '/runs');
  });
});
