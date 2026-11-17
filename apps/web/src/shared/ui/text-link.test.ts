import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent } from '../testing-dom.ts';
import { interactiveClasses } from './interactive.ts';
import { TextLink } from './text-link.tsx';

const AGENCY = '/agencies/00000000-0000-0000-0000-000000000001';

describe('TextLink', () => {
  it('is a link named by its content pointing at its target', () => {
    render(createElement(TextLink, { to: '/claims/c1' }, 'Doe, Jane'));
    const link = screen.getByRole('link', { name: 'Doe, Jane' });
    assert.equal(link.getAttribute('href'), '/claims/c1');
  });

  it('navigates in place when clicked', async () => {
    render(createElement(TextLink, { to: '/claims/c1' }, 'Doe, Jane'));
    await userEvent.setup().click(screen.getByRole('link', { name: 'Doe, Jane' }));
    assert.equal(window.location.pathname, '/claims/c1');
  });

  it('keeps links inside the current agency', () => {
    window.history.replaceState(null, '', `${AGENCY}/claims`);
    render(createElement(TextLink, { to: '/claims/c1' }, 'Doe, Jane'));
    assert.equal(
      screen.getByRole('link', { name: 'Doe, Jane' }).getAttribute('href'),
      `${AGENCY}/claims/c1`
    );
  });

  it('passes native attributes through', () => {
    render(createElement(TextLink, { to: '/docs', target: '_blank', rel: 'noopener' }, 'Docs'));
    const link = screen.getByRole('link', { name: 'Docs' });
    assert.equal(link.getAttribute('target'), '_blank');
    assert.equal(link.getAttribute('rel'), 'noopener');
  });

  it('is primary text, underlined on hover, with the shared focus ring and pointer', () => {
    render(createElement(TextLink, { to: '/x' }, 'X'));
    const classes = [...screen.getByRole('link', { name: 'X' }).classList];
    for (const c of ['text-primary', 'hover:underline', ...interactiveClasses.split(' ')]) {
      assert.ok(classes.includes(c), c);
    }
  });
});
