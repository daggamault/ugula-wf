import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, render, screen, userEvent } from '../testing-dom.ts';
import { ThemeToggle } from './theme-toggle.tsx';

const root = document.documentElement;

afterEach(() => {
  root.classList.remove('dark');
  root.style.colorScheme = '';
  localStorage.clear();
});

describe('ThemeToggle', () => {
  it('offers dark mode on a light page', () => {
    render(createElement(ThemeToggle));
    assert.ok(screen.getByRole('button', { name: 'Switch to Dark Mode' }));
  });

  it('offers light mode on a dark page', () => {
    root.classList.add('dark');
    render(createElement(ThemeToggle));
    assert.ok(screen.getByRole('button', { name: 'Switch to Light Mode' }));
  });

  it('switches the page to dark, remembers it and then offers light mode', async () => {
    render(createElement(ThemeToggle));
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Dark Mode' }));
    assert.equal(root.classList.contains('dark'), true);
    assert.equal(root.style.colorScheme, 'dark');
    assert.equal(localStorage.getItem('ugula_theme'), 'dark');
    assert.ok(await screen.findByRole('button', { name: 'Switch to Light Mode' }));
  });

  it('switches a dark page back to light and remembers it', async () => {
    root.classList.add('dark');
    render(createElement(ThemeToggle));
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Light Mode' }));
    assert.equal(root.classList.contains('dark'), false);
    assert.equal(root.style.colorScheme, 'light');
    assert.equal(localStorage.getItem('ugula_theme'), 'light');
    assert.ok(await screen.findByRole('button', { name: 'Switch to Dark Mode' }));
  });

  it('follows a theme change made elsewhere on the page', async () => {
    render(createElement(ThemeToggle));
    await act(async () => root.classList.add('dark'));
    assert.ok(await screen.findByRole('button', { name: 'Switch to Light Mode' }));
  });

  it('renders as light on the server', () => {
    assert.match(
      renderToStaticMarkup(createElement(ThemeToggle)),
      /aria-label="Switch to Dark Mode"/
    );
  });
});
