import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent, within } from '../testing-dom.ts';
import { Centered } from './centered.tsx';

describe('Centered', () => {
  it('holds the page in the main landmark, after the theme toggle', () => {
    render(createElement(Centered, { children: createElement('p', null, 'Body') }));
    const main = screen.getByRole('main');
    assert.equal(main.lastElementChild?.textContent, 'Body');
    within(main).getByRole('button', { name: 'Switch to Dark Mode' });
  });

  it('switches the theme from the corner toggle', async () => {
    render(createElement(Centered, { children: 'Body' }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Switch to Dark Mode' }));
    assert.equal(document.documentElement.classList.contains('dark'), true);
    await screen.findByRole('button', { name: 'Switch to Light Mode' });
    document.documentElement.classList.remove('dark');
    localStorage.clear();
  });
});
